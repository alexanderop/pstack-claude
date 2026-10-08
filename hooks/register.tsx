import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { PotetoRun, PotetoTodo } from '../types'

const PANE = 'pstack-poteto'
const EMPTY: PotetoRun = { playbook: null, principles: [], skills: [], agents: [], todos: [] }

const isOn = atom({ plugin: 'pstack', key: 'isOn' } as const, false)
const run = atom({ plugin: 'pstack', key: 'run' } as const, EMPTY)
const isBandHidden = atom({ plugin: 'pstack', key: 'isBandHidden' } as const, false)

const PLAYBOOK = /poteto-mode\/playbooks\/([\w-]+)\.md$/
const PRINCIPLE = /skills\/(principle-[\w-]+)\/SKILL\.md$/

const bare = (skill: string) => skill.replace(/^pstack:/, '')
const addOnce = (list: string[], item: string) => (list.includes(item) ? list : [...list, item])
const bar = (done: number, total: number, width = 10) => {
  const filled = total === 0 ? 0 : Math.round((done / total) * width)
  return '■'.repeat(filled) + '□'.repeat(width - filled)
}

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
  ].join('\n'),
})

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'poteto',
      description: 'Toggle sticky poteto-mode (on | off | reset)',
      argumentHint: 'on | off | reset',
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
      await update($, run, () => EMPTY)
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
    if (playbook !== undefined && playbook !== 'opening-a-pr') {
      await update($, run, r => ({ ...r, playbook }))
    }
    if (principle !== undefined) {
      await update($, run, r => ({ ...r, principles: addOnce(r.principles, principle) }))
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
    await update($, run, r => ({
      ...r,
      agents: [...r.agents, { id: e.tool_use_id, type: e.subagentType, description: e.description }].slice(-20),
    }))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const on_ = await read($, isOn)
    const r = await read($, run)
    const hasRun = r.playbook !== null || r.todos.length > 0
    if (e.props.hasSurvey || (await read($, isBandHidden)) || (!on_ && !hasRun)) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const done = r.todos.filter(t => t.status === 'completed').length
    const current = r.todos.find(t => t.status === 'in_progress')

    return (
      <Box>
        <Text color="warning" bold>
          👑 poteto{on_ ? '' : ' (off)'}
        </Text>
        <Text dimColor> · </Text>
        <Text color="suggestion">{r.playbook ?? 'no playbook yet'}</Text>
        {r.todos.length > 0 && (
          <Text>
            {'  '}
            <Text color="success">{bar(done, r.todos.length)}</Text> {done}/{r.todos.length}
          </Text>
        )}
        <Text dimColor>
          {'  '}
          {r.principles.length} principles · {r.agents.length} agents
          {current ? ` · ${current.content.slice(0, 40)}` : ''}{' '}
        </Text>
        <Button key="pane" label="details" onPress={() => void $.ui.open({ id: PANE, title: '👑 poteto-mode' })} />
        <Button key="hide" label="hide" onPress={() => update($, isBandHidden, () => true)} />
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
        <Text>
          Playbook: <Text color="suggestion">{r.playbook ?? '—'}</Text>
        </Text>
        <Text bold> </Text>
        <Text bold>Steps</Text>
        {r.todos.length === 0 && <Text dimColor>No todo list yet.</Text>}
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
        {r.agents.map(a => (
          <Text key={a.id} dimColor>
            {a.type}: {a.description}
          </Text>
        ))}
      </Box>
    )
  })
}
