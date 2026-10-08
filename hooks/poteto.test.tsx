import { expect, mock, test } from 'claude-code/testing'

const MODEL = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] }

test('/poteto on makes poteto-mode sticky in the system prompt', async ($, on) => {
  mock.clock(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))

  const before = await $.prompt.compose(MODEL)
  expect(before.sections.map(s => s.id)).toEqual(['intro'])

  await $.command.run({ command: 'poteto', args: 'on' } as never)
  const after = await $.prompt.compose(MODEL)
  expect(after.sections.map(s => s.id)).toEqual(['intro', 'pstack:poteto-mode'])

  await $.command.run({ command: 'poteto', args: 'off' } as never)
  const off = await $.prompt.compose(MODEL)
  expect(off.sections.map(s => s.id)).toEqual(['intro'])
})

test('the band shows the playbook and step progress', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: {} as never }))

  await $.command.run({ command: 'poteto', args: 'on' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/x/pstack/skills/poteto-mode/playbooks/bug-fix.md' })
  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Reproduce', status: 'completed', activeForm: 'Reproducing' },
      { content: 'Root-cause', status: 'in_progress', activeForm: 'Root-causing' },
      { content: 'Fix and verify', status: 'pending', activeForm: 'Fixing' },
    ],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'pstack', surface, component: 'AbovePrompt', props: { hasSurvey: false } as never })
    expect(await ui.find({ type: 'Text', text: 'bug-fix' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\/3/ })).toBeDefined()
    await ui.unmount()
  }
})

test('invoking poteto-mode shows the band at once, before any playbook', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', ($, e) => ({ text: e.text }))

  await $.skill.prompt({ skill: 'pstack:poteto-mode', text: 'poteto mode' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'pstack', surface, component: 'AbovePrompt', props: { hasSurvey: false } as never })
    expect(await ui.find({ type: 'Text', text: /picking a playbook/ })).toBeDefined()
    await ui.unmount()
  }
})

test('poteto_status step numbers walk the playbook steps the mod loaded', async ($, on) => {
  mock.clock(on)
  on('fs.read', () => ({ value: '### Bug fix\n\n1. Reproduce it. More text.\n2. Find the cause.\n3. Plan the fix.\n4. Verify it.\n' }))

  await $.tool.call({ tool: 'mcp__pstack__poteto_status', playbook: 'bug-fix' } as never)
  await $.tool.call({ tool: 'mcp__pstack__poteto_status', playbook: 'bug-fix', step: 3 } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'pstack', surface, component: 'AbovePrompt', props: { hasSurvey: false } as never })
    expect(await ui.find({ type: 'Text', text: /step 3\/4/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /3\. Plan the fix\./ })).toBeDefined()
    await ui.unmount()
  }
})

test('the band switches to done when the turn completes', async ($, on) => {
  mock.clock(on)
  on('fs.read', () => ({ value: '1. One.\n2. Two.\n3. Three.\n' }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  await $.tool.call({ tool: 'mcp__pstack__poteto_status', playbook: 'bug-fix', step: 2 } as never)
  await $.turn.complete({ answer: 'fixed', durationMs: 40_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'pstack', surface, component: 'AbovePrompt', props: { hasSurvey: false } as never })
    expect(await ui.find({ type: 'Text', text: /✔ done in 40s/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /■■■■■■■■■■/ })).toBeDefined()
    await ui.unmount()
  }
})

const STEPS = { value: '1. Reproduce it.\n2. Find the cause.\n3. Plan the fix.\n4. Verify it.\n' }

test('a poteto_status call draws as one compact transcript line', async ($, on) => {
  mock.clock(on)
  on('fs.read', () => STEPS)
  await $.tool.call({ tool: 'mcp__pstack__poteto_status', playbook: 'bug-fix', step: 4 } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'pstack',
      surface,
      component: 'ToolUse',
      props: { tool_use_id: 't1', tool: 'mcp__pstack__poteto_status', input: { playbook: 'bug-fix', step: 4 }, isRunning: false, isErrored: false, isInterrupted: false },
    })
    expect(await ui.find({ type: 'Text', text: /step 4\/4 · Verify it\./ })).toBeDefined()
    await ui.unmount()
  }
})

test('the spinner names the current step', async ($, on) => {
  mock.clock(on)
  on('fs.read', () => STEPS)
  on('ui.render', { component: 'Spinner' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    const props = e.props as { word: string; message: string | null }
    return <Text>{props.message ?? props.word}</Text>
  })
  await $.tool.call({ tool: 'mcp__pstack__poteto_status', playbook: 'bug-fix', step: 2 } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'pstack', surface, component: 'Spinner', props: { word: 'Wandering', message: null, suffix: '…', mode: 'thinking' } })
    expect(await ui.find({ type: 'Text', text: 'Wandering · 👑 2/4 Find the cause.' })).toBeDefined()
    await ui.unmount()
  }
})

test('subagents show as running, then done on SubagentStop', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('classic.SubagentStop', () => ({}) as never)
  await $.command.run({ command: 'poteto', args: 'on' } as never)
  await $.agent.spawn({ tool_use_id: 'u1', prompt: 'p', description: 'Reproduce the bug', subagentType: 'pstack:poteto-agent' } as never)

  const band = { plugin: 'pstack', surface: 'terminal' as const, component: 'AbovePrompt' as const, props: { hasSurvey: false } as never }
  let ui = await $.ui.mount(band)
  expect(await ui.find({ type: 'Text', text: /1 agent running/ })).toBeDefined()
  await ui.unmount()

  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1', agent_transcript_path: '/x', agent_type: 'pstack:poteto-agent' } as never)
  ui = await $.ui.mount(band)
  expect(await ui.find({ type: 'Text', text: /1 agent done/ })).toBeDefined()
  await ui.unmount()
})

test('a turn that ends while a subagent runs waits instead of finishing', async ($, on) => {
  mock.clock(on)
  on('fs.read', () => STEPS)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))
  on('classic.SubagentStop', () => ({}) as never)
  on('turn.complete', ($, e) => ({ text: e.answer }))

  await $.tool.call({ tool: 'mcp__pstack__poteto_status', playbook: 'bug-fix', step: 2 } as never)
  await $.agent.spawn({ tool_use_id: 'u1', prompt: 'p', description: 'Find the cause', subagentType: 'pstack:poteto-agent' } as never)
  await $.turn.complete({ answer: 'delegated', durationMs: 5_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)

  const band = { plugin: 'pstack', surface: 'terminal' as const, component: 'AbovePrompt' as const, props: { hasSurvey: false } as never }
  let ui = await $.ui.mount(band)
  expect(await ui.find({ type: 'Text', text: /waiting for subagents/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /done in/ })).toBeUndefined()
  await ui.unmount()

  await $.classic.SubagentStop({ stop_hook_active: false, agent_id: 'a1', agent_transcript_path: '/x', agent_type: 'pstack:poteto-agent' } as never)
  await $.turn.complete({ answer: 'fixed', durationMs: 5_000, isAborted: false, turnId: 't2', reason: 'answer' } as never)
  ui = await $.ui.mount(band)
  expect(await ui.find({ type: 'Text', text: /✔ done in/ })).toBeDefined()
  await ui.unmount()
})
