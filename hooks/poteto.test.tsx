import { expect, test } from 'claude-code/testing'

const MODEL = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] }

test('/poteto on makes poteto-mode sticky in the system prompt', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))

  const before = await $.prompt.compose(MODEL)
  expect(before.sections.map(s => s.id)).toEqual(['intro'])

  await $.command.run({ command: 'poteto', args: 'on' })
  const after = await $.prompt.compose(MODEL)
  expect(after.sections.map(s => s.id)).toEqual(['intro', 'pstack:poteto-mode'])

  await $.command.run({ command: 'poteto', args: 'off' })
  const off = await $.prompt.compose(MODEL)
  expect(off.sections.map(s => s.id)).toEqual(['intro'])
})

test('the band shows the playbook and step progress', async ($, on) => {
  on('tool.call', () => ({ result: {} as never }))

  await $.command.run({ command: 'poteto', args: 'on' })
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
  on('skill.prompt', ($, e) => ({ text: e.text }))

  await $.skill.prompt({ skill: 'pstack:poteto-mode', text: 'poteto mode' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'pstack', surface, component: 'AbovePrompt', props: { hasSurvey: false } as never })
    expect(await ui.find({ type: 'Text', text: /picking a playbook/ })).toBeDefined()
    await ui.unmount()
  }
})
