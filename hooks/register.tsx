import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PotetoAgent, PotetoRun, PotetoTodo } from '../types'

const PANE = 'pstack-poteto'
const STATUS_TOOL = 'mcp__pstack__poteto_status'
const REPORT = [
  '',
  '## Reporting progress (Claude Code)',
  `The user watches a live band driven only by the \`${STATUS_TOOL}\` tool. Call it, every time:`,
  '1. right after you pick a playbook (or "none: <reason>"),',
  '2. at the start of each playbook step, with `step` set to that step\'s number (1, 2, 3, ...),',
  '3. before your final reply, with every principle you applied (skill names, e.g. principle-model-the-domain).',
  'Read playbook and principle files with the Read tool.',
].join('\n')
const EMPTY: PotetoRun = { isActive: false, doneMs: null, startedAt: null, isWaiting: false, step: null, steps: [], stepIndex: null, playbook: null, principles: [], skills: [], agents: [], todos: [] }

const isOn = atom({ plugin: 'pstack', key: 'isOn' } as const, false)
const run = atom({ plugin: 'pstack', key: 'run' } as const, EMPTY)
const isBandHidden = atom({ plugin: 'pstack', key: 'isBandHidden' } as const, false)

const PLAYBOOK = /poteto-mode\/playbooks\/([\w-]+)\.md$/
const MODE_SKILL = /skills\/poteto-mode\/SKILL\.md$/
const PRINCIPLE = /skills\/(principle-[\w-]+)\/SKILL\.md$/

const bare = (skill: string) => skill.replace(/^pstack:/, '')
const addOnce = (list: string[], item: string) => (list.includes(item) ? list : [...list, item])
const bar = (done: number, total: number, width = 10) => {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)
  return '■'.repeat(filled) + '□'.repeat(width - filled)
}

// "1. Reproduce it yourself on ..." -> "Reproduce it yourself on ..." (first sentence, short)
const STEP_LINE = /^(\d+)\.\s+(.*)$/
const shortStep = (text: string) => {
  const plain = text.replace(/\*\*|`/g, '')
  const sentence = plain.split(/(?<=\.)\s/)[0] ?? plain
  return sentence.length > 70 ? `${sentence.slice(0, 69)}…` : sentence
}
const parseSteps = (markdown: string) =>
  markdown.split('\n').flatMap(line => {
    const text = STEP_LINE.exec(line)?.[2]
    return text === undefined ? [] : [shortStep(text)]
  })

// Cursor's `mode: true` keeps poteto-mode in context every turn. Claude Code has no
// sticky skills, so the mod adds the skill's own `reminder` as a system-prompt section.
const modeSection = (root: string) => ({
  id: 'pstack:poteto-mode',
  scope: 'session' as const,
  text: [
    '# pstack: poteto-mode is ON (sticky)',
    'New task? Playbook match or rigor needed -> apply poteto-mode. Casual turn or user opts out -> don\'t.',
    `Applying it means: Read ${root}/skills/poteto-mode/SKILL.md in full, pick a playbook from ${root}/skills/poteto-mode/playbooks/, ` +
      'and open a todo list whose first items are that playbook\'s steps, copied verbatim.',
    `Principle and helper skills live at ${root}/skills/<name>/SKILL.md; read a leaf in full before citing it.`,
    'Spawn subagents as subagent_type "pstack:poteto-agent" (comment review: "pstack:comment-sicko").',
    REPORT,
  ].join('\n'),
})

// The moment poteto-mode is invoked (typed as a skill, or read by the model under
// sticky mode): fresh run, band back on screen, a toast and a status line entry.
const engage = async ($: EngineInterface) => {
  const startedAt = await $.clock.now()
  await update($, run, () => ({ ...EMPTY, isActive: true, startedAt }))
  await update($, isBandHidden, () => false)
  $.ui.toast('👑 poteto-mode engaged: picking a playbook')
  $.ui.status('👑 poteto-mode')
}

const setPlaybook = async ($: EngineInterface, playbook: string) => {
  const current = await read($, run)
  if (current.playbook === playbook && current.steps.length > 0) return

  const steps = await $.fs
    .read(`${$.plugin.root}/skills/poteto-mode/playbooks/${playbook}.md`)
    .then(parseSteps, () => [])
  await update($, run, r => ({ ...r, isActive: true, doneMs: null, playbook, steps, stepIndex: steps.length > 0 ? r.stepIndex ?? 0 : null }))
  $.ui.status(`👑 poteto-mode · ${playbook}`)
}

// Playbook steps when the mod knows them, else the model's todo list.
const progress = (r: PotetoRun) => {
  if (r.doneMs !== null) {
    const total = Math.max(r.steps.length, r.todos.length, 1)
    return { done: total, total, label: `✔ done in ${Math.round(r.doneMs / 1000)}s`, current: null }
  }
  if (r.steps.length > 0) {
    const i = r.stepIndex ?? 0
    if (r.isWaiting) {
      return { done: i, total: r.steps.length, label: `step ${i + 1}/${r.steps.length} · waiting for subagents`, current: `${i + 1}. ${r.steps[i] ?? ''}` }
    }
    return { done: i, total: r.steps.length, label: `step ${i + 1}/${r.steps.length}`, current: `${i + 1}. ${r.steps[i] ?? ''}` }
  }
  const done = r.todos.filter(t => t.status === 'completed').length
  const current = r.todos.find(t => t.status === 'in_progress')?.content ?? r.step

  return { done, total: r.todos.length, label: `${done}/${r.todos.length}`, current }
}

const agentSummary = (r: PotetoRun) => {
  const running = r.agents.filter(a => a.status === 'running').length
  const done = r.agents.length - running
  if (r.agents.length === 0) return '0 agents'
  return running > 0 ? `◐ ${running} agent${running === 1 ? '' : 's'} running · ${done} done` : `${done} agent${done === 1 ? '' : 's'} done`
}

// `step` arrives as 3, "3", or "3. Plan the fix": a 1-based playbook step number.
const stepNumber = (step: unknown) => {
  const n = typeof step === 'number' ? step : typeof step === 'string' ? Number.parseInt(step, 10) : Number.NaN
  return Number.isFinite(n) && n >= 1 ? n : null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'poteto',
      description: 'Toggle sticky poteto-mode (on | off | reset)',
      argumentHint: 'on | off | reset',
    })
    await $.tool.register({
      name: 'poteto_status',
      description:
        'Report poteto-mode progress to the user\'s live band: the matched playbook, principles applied, and the current step. ' +
        'Call it when you pick a playbook and whenever the step or principles change.',
      inputSchema: {
        type: 'object',
        properties: {
          playbook: { type: 'string', description: 'Playbook file name without .md (bug-fix, feature, investigation, ...), or "none: <reason>"' },
          principles: { type: 'array', items: { type: 'string' }, description: 'Principle skill names applied so far' },
          step: { type: ['integer', 'string'], description: 'The number of the playbook step you are starting (1, 2, 3, ...)' },
        },
        required: ['playbook'],
      },
      isDeferred: false,
    })
    await $.command.register({
      name: 'poteto-pane',
      description: 'Show the live poteto-mode run: playbook, steps, principles, subagents',
    })

    return next(e)
  })

  on('command.run', { command: 'poteto' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'reset') {
      await update($, run, () => EMPTY)
      $.ui.status(undefined)
      return { text: 'poteto-mode run cleared.' }
    }
    const next = arg === 'on' ? true : arg === 'off' ? false : !(await read($, isOn))
    await update($, isOn, () => next)
    await update($, isBandHidden, () => false)
    $.ui.toast(next ? '👑 poteto-mode on' : 'poteto-mode off')

    return { text: next ? 'poteto-mode is on for every turn of this session.' : 'poteto-mode is off.' }
  })

  on('command.run', { command: 'poteto-pane' }, async $ => {
    await $.ui.open({ id: PANE, title: '👑 poteto-mode' })

    return { text: 'poteto-mode pane opened.' }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, isOn))) return composed

    return { sections: [...composed.sections, modeSection($.plugin.root)] }
  })

  // `/pstack:poteto-mode` starts a new task: fresh run, playbook picked next.
  on('skill.prompt', async ($, e, next) => {
    const name = bare(e.skill)
    if (name === 'poteto-mode') {
      await engage($)
      return next({ ...e, text: e.text + REPORT })
    } else {
      await update($, run, r => ({
        ...r,
        principles: name.startsWith('principle-') ? addOnce(r.principles, name) : r.principles,
        skills: name.startsWith('principle-') ? r.skills : addOnce(r.skills, name),
      }))
    }

    return next(e)
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const playbook = PLAYBOOK.exec(e.file_path)?.[1]
    const principle = PRINCIPLE.exec(e.file_path)?.[1]
    if (MODE_SKILL.test(e.file_path) && !(await read($, run)).isActive) {
      await engage($)
    }
    if (playbook !== undefined && playbook !== 'opening-a-pr') {
      await setPlaybook($, playbook)
    }
    if (principle !== undefined) {
      await update($, run, r => ({ ...r, principles: addOnce(r.principles, principle) }))
    }

    return next(e)
  })

  on('tool.call', { tool: STATUS_TOOL }, async ($, e) => {
    const input = e as unknown as { playbook?: unknown; principles?: unknown; step?: unknown }
    const playbook = typeof input.playbook === 'string' ? input.playbook.trim() : null
    const principles = Array.isArray(input.principles) ? input.principles.filter((p): p is string => typeof p === 'string') : []
    const n = stepNumber(input.step)

    if (playbook !== null && /^[\w-]+$/.test(playbook)) {
      await setPlaybook($, playbook)
    } else if (playbook !== null) {
      await update($, run, r => ({ ...r, isActive: true, playbook, steps: [], stepIndex: null }))
      $.ui.status(`👑 poteto-mode · ${playbook.slice(0, 40)}`)
    }
    await update($, run, r => ({
      ...r,
      isActive: true,
      doneMs: null,
      isWaiting: false,
      stepIndex: n !== null && r.steps.length > 0 ? Math.min(n, r.steps.length) - 1 : r.stepIndex,
      step: typeof input.step === 'string' && n === null ? input.step : r.step,
      principles: principles.reduce(addOnce, r.principles),
    }))

    return { result: 'Band updated.' }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const playbook = /poteto-mode\/playbooks\/([\w-]+)\.md/.exec(e.command)?.[1]
    if (playbook !== undefined && playbook !== 'opening-a-pr') {
      await setPlaybook($, playbook)
    }

    return next(e)
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const todos: PotetoTodo[] = e.todos.map((t, i) => ({ id: String(i), content: t.content, status: t.status }))
    await update($, run, r => ({ ...r, todos }))

    return next(e)
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const id = (ran.result as { task?: { id: string } } | undefined)?.task?.id
    if (id !== undefined) {
      const todo: PotetoTodo = { id, content: e.subject, status: 'pending' }
      await update($, run, r => ({ ...r, todos: [...r.todos, todo] }))
    }

    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    const status = e.status
    if (status !== undefined) {
      await update($, run, r => ({
        ...r,
        todos:
          status === 'deleted'
            ? r.todos.filter(t => t.id !== e.taskId)
            : r.todos.map(t => (t.id === e.taskId ? { ...t, status, content: e.subject ?? t.content } : t)),
      }))
    }

    return ran
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const agentId = spawned.deny === undefined ? spawned.agentId ?? null : null
    if (spawned.deny === undefined) {
      const agent: PotetoAgent = { id: e.tool_use_id, agentId, type: e.subagentType, description: e.description, status: 'running' }
      await update($, run, r => ({ ...r, agents: [...r.agents, agent].slice(-20) }))
    }

    return spawned
  })

  on('classic.SubagentStop', async ($, e, next) => {
    await update($, run, r => ({
      ...r,
      agents: r.agents.map(a => (a.agentId === e.agent_id ? { ...a, status: 'done' as const } : a)),
    }))

    return next(e)
  })

  // The reply is out: the run is finished until the model reports again.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const r = await read($, run)
    if (e.reason !== 'answer' || !r.isActive || r.playbook === null || r.doneMs !== null) return result

    // A background subagent is still working: the run resumes when it reports back.
    if (r.agents.some(a => a.status === 'running')) {
      await update($, run, cur => ({ ...cur, isWaiting: true }))
      return result
    }
    const now = await $.clock.now()
    const doneMs = r.startedAt !== null ? now - r.startedAt : e.durationMs
    await update($, run, cur => ({
      ...cur,
      doneMs,
      isWaiting: false,
      stepIndex: cur.steps.length > 0 ? cur.steps.length - 1 : cur.stepIndex,
    }))
    $.ui.status(`👑 poteto-mode · ${r.playbook} ✔ done`)

    return result
  })

  // The status tool's transcript row: one dim line in place of the MCP call and its "Band updated."
  on('ui.render', { component: 'ToolUse', props: { tool: STATUS_TOOL } }, async ($, e, next) => {
    if (e.props.isErrored) return next(e)
    const { Text } = $.ui.resolve(e)
    const input = e.props.input as { playbook?: unknown; step?: unknown }
    const r = await read($, run)
    const n = stepNumber(input.step)
    const playbook = typeof input.playbook === 'string' ? input.playbook : r.playbook ?? '?'
    const where =
      n !== null && r.playbook === playbook && r.steps.length > 0
        ? ` → step ${Math.min(n, r.steps.length)}/${r.steps.length} · ${r.steps[Math.min(n, r.steps.length) - 1] ?? ''}`
        : n === null
          ? ' · playbook picked'
          : ` → step ${n}`

    return (
      <Text dimColor>
        <Text color="warning">👑</Text> {playbook}
        {where}
      </Text>
    )
  })

  // The animated line names the step while a poteto-mode run is in progress.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const r = await read($, run)
    if (!r.isActive || r.doneMs !== null || r.steps.length === 0 || r.stepIndex === null) return next(e)
    const step = r.steps[r.stepIndex] ?? ''
    const short = step.length > 48 ? `${step.slice(0, 47)}…` : step

    return next({ ...e, props: { ...e.props, message: `${e.props.message ?? e.props.word} · 👑 ${r.stepIndex + 1}/${r.steps.length} ${short}` } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const on_ = await read($, isOn)
    const r = await read($, run)
    const hasRun = r.playbook !== null || r.todos.length > 0
    if (e.props.hasSurvey || (await read($, isBandHidden)) || (!on_ && !r.isActive && !hasRun)) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const p = progress(r)

    return (
      <Box flexDirection="column">
        <Box>
          <Text color="warning" bold>
            👑 poteto{on_ ? ' (sticky)' : ''}
          </Text>
          <Text dimColor> · </Text>
          <Text color="suggestion" bold>
            {r.playbook ?? (r.isActive ? 'picking a playbook…' : 'no playbook yet')}
          </Text>
          {p.total > 0 && (
            <Text>
              {'  '}
              <Text color="success">{bar(p.done, p.total)}</Text> {p.label}
            </Text>
          )}
          <Text dimColor>
            {'  '}
            {r.principles.length} principle{r.principles.length === 1 ? '' : 's'} · {agentSummary(r)}{' '}
          </Text>
          <Button key="pane" label="details" onPress={() => void $.ui.open({ id: PANE, title: '👑 poteto-mode' })} />
          <Button key="hide" label="hide" onPress={() => update($, isBandHidden, () => true)} />
        </Box>
        {p.current !== null && (
          <Text>
            {'   '}
            <Text color="warning">▶</Text> {p.current}
          </Text>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const r = await read($, run)
    const mark = { completed: '✔', in_progress: '▶', pending: '○' } as const

    return (
      <Box flexDirection="column">
        <Text bold>Mode: {(await read($, isOn)) ? 'sticky ON' : 'off (/poteto on)'}</Text>
        {r.doneMs !== null && <Text color="success" bold>✔ Done in {Math.round(r.doneMs / 1000)}s</Text>}
        <Text>
          Playbook: <Text color="suggestion">{r.playbook ?? '—'}</Text>
        </Text>
        <Text bold> </Text>
        <Text bold>Playbook steps</Text>
        {r.steps.length === 0 && <Text dimColor>Waiting for a playbook.</Text>}
        {r.steps.map((step, i) => {
          const i_ = r.stepIndex ?? 0
          const state = r.doneMs !== null || i < i_ ? 'completed' : i === i_ ? 'in_progress' : 'pending'
          return (
            <Text key={`s${i}`} color={state === 'in_progress' ? 'warning' : undefined} dimColor={state === 'completed'}>
              {mark[state]} {i + 1}. {step}
            </Text>
          )
        })}
        {r.todos.length > 0 && <Text bold> </Text>}
        {r.todos.length > 0 && <Text bold>Todo list</Text>}
        {r.todos.map(t => (
          <Text key={t.id} color={t.status === 'in_progress' ? 'warning' : undefined} dimColor={t.status === 'completed'}>
            {mark[t.status]} {t.content}
          </Text>
        ))}
        <Text bold> </Text>
        <Text bold>Principles read ({r.principles.length})</Text>
        <Text dimColor>{r.principles.map(p => p.replace('principle-', '')).join(', ') || '—'}</Text>
        <Text bold> </Text>
        <Text bold>Skills used</Text>
        <Text dimColor>{r.skills.join(', ') || '—'}</Text>
        <Text bold> </Text>
        <Text bold>Subagents ({r.agents.length})</Text>
        {r.agents.length === 0 && <Text dimColor>—</Text>}
        {r.agents.map(a => (
          <Text key={a.id} color={a.status === 'running' ? 'warning' : undefined} dimColor={a.status === 'done'}>
            {a.status === 'running' ? '◐' : '✔'} {a.type.replace(/^pstack:/, '')}: {a.description}
          </Text>
        ))}
      </Box>
    )
  })
}
