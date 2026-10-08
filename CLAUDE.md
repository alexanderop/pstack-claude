# pstack-claude

A Claude Code port of [poteto's pstack](https://github.com/cursor/plugins/tree/main/pstack) (Cursor plugin, MIT, Lauren Tan), plus a **Claude Code mod** (`hooks/register.tsx`) that adds a sticky poteto-mode and a live progress view. Public repo: `alexanderop/pstack-claude`.

## Layout

| Path | What it is |
|---|---|
| `skills/` | Upstream skills. `poteto-mode/` is the router: `SKILL.md`, 23 `playbooks/*.md`, `scripts/` |
| `skills/principle-*/` | The principle leaves poteto-mode cites |
| `agents/` | `poteto-agent`, `comment-sicko` (spawned as `pstack:<name>`) |
| `hooks/register.tsx` | The mod: every hook lives here |
| `hooks/poteto.test.tsx` | Mod tests (`claude plugin test`) |
| `types/index.d.ts` | The mod's `$.state` contract (`PluginState['pstack']`) |
| `.claude-plugin/plugin.json` | Manifest. `version` is what users see on update |
| `.claude-plugin/marketplace.json` | Makes this repo a one-plugin marketplace |
| `.claude-plugin/types/` | Generated API types, gitignored (see Type-check) |

## What the port changed from upstream

Keep these when syncing from `cursor/plugins`:

- Names: `AskQuestion` → `AskUserQuestion`, `generalPurpose` → `general-purpose`, agents referenced as `pstack:poteto-agent` / `pstack:comment-sicko`. Agent and skill `name:` fields are kebab-case (`poteto-mode`, `comment-sicko`, `make-bot-ui`).
- `is_background` removed from `agents/poteto-agent.md` (Cursor-only).
- `disable-model-invocation: true` removed from the router skills (`how`, `why`, `architect`, `arena`, `swarm`, `interrogate`, `unslop`, `no-comments`, `technical-writing`, `tdd`, `benchmark-checklist`, `blast-radius`, `typescript-best-practices`, `show-me-your-work`, `figure-it-out`) so the model can call them. Principles and `poteto-mode` stay user-only; the model reads them by file path.
- Not ported: Cursor multi-model routing (Grok/Opus), `cursor-team-kit` skills (`deslop`, `control-ui`, `control-cli`, `create-skill`). Text that mentions them is left as upstream wrote it.

## How the mod works

State lives in `$.state` (`isOn`, `run`, `isBandHidden`), never in module variables: a hot reload re-runs `register` and drops them.

Data flow for one poteto-mode run:

1. `/pstack:poteto-mode` → `skill.prompt` hook → `engage()`: fresh `run`, toast, status line, and the `REPORT` instructions appended to the skill text.
2. The model calls the mod's own tool `mcp__pstack__poteto_status` (`playbook`, `step` number, `principles`). This is the **primary signal**. File reads are a fallback: `Read` (or `cat` in Bash) of `poteto-mode/playbooks/<name>.md` or `principle-*/SKILL.md`.
3. `setPlaybook()` reads the playbook file itself (`$.fs.read`) and parses its `1. …` lines into `run.steps`. The model only reports a step **number**; the mod owns the step text.
4. `agent.spawn` records subagents (`agentId`, `running`). `classic.SubagentStop` with the same `agent_id` marks them `done`.
5. `turn.complete`: subagents still running → `isWaiting`. Otherwise → `doneMs` (measured from `engage`, not the last turn).

What draws:

| Site | Hook | Shows |
|---|---|---|
| Band above the prompt | `ui.render {component:'AbovePrompt'}` | playbook, step bar, principles, agents, current step |
| Pane (`[details]`, `/poteto-pane`) | `ui.render {component:'Pane', requestId}` | all steps ✔ ▶ ○, todos, principles, skills, subagents |
| Transcript row of the status tool | `ui.render {component:'ToolUse', props:{tool}}` | one dim line in place of the MCP call + "Band updated." |
| Spinner | `ui.render {component:'Spinner'}` | `Wandering · 👑 2/6 <step>` |
| Status line, toast | `$.ui.status`, `$.ui.toast` | engaged / playbook / done |

Sticky mode: `/poteto on` adds a `pstack:poteto-mode` section through `prompt.compose`. That replaces Cursor's `mode: true` + option+Enter.

## Verify a change

Run all of these before pushing. They take about 2 minutes, plus about 1 minute per live run.

### 1. Validate

```bash
claude plugin validate .
```

Lists every hook and `$` call the engine sees. The "gating hook without .catch" lines are expected: those hooks observe and never refuse.

### 2. Type-check

```bash
claude -p "/poteto off" --plugin-dir .
tsc -p .
```

The first command loads the plugin from this folder, which writes `.claude-plugin/types/` (API, built-in tools, tsconfig). Re-run it after a Claude Code update. The installed plugin does **not** write these types.

### 3. Mod tests

```bash
claude plugin test .
```

Expect `9 pass, 4 fail`: the 4 failures are upstream's `skills/poteto-mode/scripts/**/*.test.ts`, which import `bun:test` and cannot load in the mod runner. Ignore them; every `hooks/poteto.test.tsx` test must pass.

Test-kit rules learned the hard way:
- Nothing sits beneath the plugin. The test answers every event the mod calls down to: `on('prompt.compose', () => ({ sections: [...] }))`, `on('turn.complete', ($, e) => ({ text: e.answer }))`, `on('agent.spawn', () => ({ model, agentId }))`.
- Hooks are `($, e, next)`. `on('x', e => …)` takes `$` as `e` and fails silently.
- Op events answer `{ value }`: `on('fs.read', () => ({ value: '1. A.\n2. B.\n' }))`.
- `mock.clock(on)` in every test; `$.clock.now()` otherwise throws and the hook is skipped.
- `$.prompt.compose(...)` needs the full input: `model`, `promptModel`, `surfaces`, `tools`, `outputStyle`, `traits`.
- Drawing tests: `$.ui.mount({ plugin: 'pstack', surface, component, props })`, loop over `['terminal', 'desktop']`, then `ui.find({ type: 'Text', text: /…/ })`. A site the engine draws (Spinner) needs a bottom `ui.render` hook that returns a tree.
- `ui.toast` / `ui.status` "dropped" lines in the output are expected.

### 4. Headless run (`claude -p`)

Checks that the plugin loads, the commands answer, and the model calls the tool. Use a throwaway git repo with one small bug:

```bash
claude -p "/pstack:poteto-mode <small bug>. Repro first, then fix and verify. Don't commit." \
  --output-format stream-json --verbose --model claude-sonnet-5-5 \
  --permission-mode acceptEdits --allowedTools "Bash(node:*)" > out.jsonl
grep '^{' out.jsonl | jq -r 'select(.type=="assistant")|.message.content[]?|select(.type=="tool_use")|"\(.name): \(.input|tostring|.[0:160])"'
```

Expect `mcp__pstack__poteto_status` first with a playbook, then the playbook read. Limits of `-p`:
- The band, spinner and pane are not drawn. Use step 5 to see them.
- There is no TodoWrite or TaskCreate tool, so todo-driven progress never shows.
- Pipe from `/dev/null` or pass the prompt as an argument, or `-p` waits 3 s for stdin and prints a warning line before the JSON (`grep '^{'` filters it).
- To check sticky mode, send `/poteto on` and a question in one session with `--input-format stream-json`. Ask Sonnet to quote the section; Haiku tends to say NO rather than reveal its system prompt.
- `--debug --debug-file dbg.txt` shows every hook settle, `$.ui.log` lines, and skipped hooks with the reason.

### 5. Live interactive run (tmux)

The only way to see the band, spinner and transcript rows:

```bash
tmux new-session -d -s pt -x 240 -y 60 -c <toy-repo> \
  "claude --model claude-sonnet-5-5 --permission-mode acceptEdits --allowedTools 'Bash(node:*)' 'mcp__pstack__poteto_status' 'Agent'"
tmux send-keys -t pt -l "/pstack:poteto-mode <task>"; tmux send-keys -t pt Enter
tmux capture-pane -t pt -p | grep -A1 "👑 poteto ·"     # the band, poll every few seconds
tmux capture-pane -t pt -p -S -300 | grep "👑"          # compact transcript rows, spinner
tmux kill-session -t pt
```

A new folder shows the workspace trust dialog first: `tmux send-keys -t pt Down Enter`. To make a subagent run, ask for it in the prompt ("Delegate the root-cause investigation to one pstack:poteto-agent subagent").

## Gotchas

- **Plugin folder reads.** poteto-mode reads its own playbooks, which sit outside the project. Without `~/Projects/active/pstack-claude` in `permissions.additionalDirectories` (`~/.claude/settings.json`), every read prompts, and `-p` runs are denied and the model guesses the playbook. Do not make the mod allow its own reads through a `tool.check` hook: auto mode's classifier blocks that edit as a permission bypass.
- **The model does not reliably read files it cites.** It names principles it never opened and skips playbook steps. That is why the band is driven by the explicit tool call and the step number, not inferred from reads.
- **MCP tool results must be a string** (or array, or undefined): `return { result: 'Band updated.' }`. An object fails the output-shape check.
- **Plugin tools are `mcp__<plugin>__<name>`**, registered in `session.start` with `isDeferred: false` so the model sees the schema without ToolSearch. The first call in a session may prompt for permission.
- **Background subagents end the main turn.** `turn.complete` fires while they run; the run is finished only after `classic.SubagentStop` and a later turn.
- **Installed from this folder.** `claude plugin list` shows `Read from: ~/Projects/active/pstack-claude`. Edits take effect at the next session or `/reload-plugins`; `claude plugin update` has nothing to do. The marketplace is named `pstack`, which once pointed at the separate fork `alexanderop/pstack` (`~/Projects/active/pstack`); do not confuse the two.
- **Shell aliases.** `rm` and `mv` prompt interactively on this machine and hang a non-interactive command. Use `/bin/rm -f` and `/bin/mv -f`.

## Release

1. Bump `version` in `.claude-plugin/plugin.json` (`0.15.15-cc.N`): users who installed from GitHub only get changes on a new version.
2. Run steps 1 to 3 of Verify a change; step 5 for any drawing change.
3. Commit and `git push` to `main`.

Install line for users (terminal session):

```
/plugin install pstack --marketplace alexanderop/pstack-claude
```
