# Upstream sync

This port tracks [Cursor's pstack](https://github.com/cursor/plugins/tree/main/pstack), by Lauren Tan, under its MIT license.

The current source is version **0.15.25**, pinned to repository commit [`850d7f2e9f5e55dff7eb00a0a479337fe79eb22f`](https://github.com/cursor/plugins/commit/850d7f2e9f5e55dff7eb00a0a479337fe79eb22f). The Claude Code plugin version is **0.15.25-cc.1**.

## Changes since 0.15.17

- New skills: `/in-your-own-words` plays back the user's goal and problem before work; `/sharpen` frames a task the way a top expert would. Both are user-only; in Claude Code invoke `/pstack:in-your-own-words` and `/pstack:sharpen`.
- `/ketchup` now reads like `/bro` in about 150 words, builds on screenshots, videos and diagrams, and shows decisions as before/after visuals. Autopilot loops call it to catch the operator up.
- The chat that receives `/poteto-mode` runs the playbook; `poteto-agent` is only a delegate and gets the absolute path of `poteto-mode/SKILL.md` in its prompt. `poteto-mode` dropped its ignored `mode` and `reminder` frontmatter.
- poteto-mode's Subagents section matches each spawn's effort and speed to the job. Orchestrate dropped Graphite, and several playbooks and principles were cut down.
- Fixes: `check-plan` respects fenced code blocks, `watch-pr` paginates review threads past 100, `worktree-audit.sh` checks `MERGED` against the PR base (`-b`), and `create-verification-skill` treats readiness as "the app is usable". The Comment Sicko agent id is now `comment-sicko` upstream too.
- Upstream added an Agent Plugins v1 root `plugin.json`; it is not copied (see below).

## Sync scope

Copy `pstack/skills`, `agents`, `docs`, `automations`, and `assets` from the pinned source. Do not copy upstream's root `plugin.json` (Agent Plugins manifest) or `.cursor-plugin/`. Preserve file modes and the MIT license. Keep the Claude introduction above the upstream README. Do not copy Cursor's plugin manifest over `.claude-plugin/plugin.json`.

Apply these existing port adaptations to Markdown files:

- Replace `AskQuestion` with `AskUserQuestion` and `generalPurpose` with `general-purpose`.
- Replace `subagent_type: "poteto-agent"` with `subagent_type: "pstack:poteto-agent"`, and `subagent_type: "Comment Sicko"` with `subagent_type: "pstack:comment-sicko"`.
- Set each skill's frontmatter `name` to its directory name and each agent's `name` to its file stem.
- Remove `is_background: true` from `agents/poteto-agent.md`.
- In `agents/poteto-agent.md`, point the fallback search for `poteto-mode/SKILL.md` at `~/.claude/plugins/` and `.claude-plugin/plugin.json` instead of `~/.cursor/plugins/` and `.cursor-plugin/plugin.json`, and say `Agent spawn` instead of `Task spawn`.
- Remove `disable-model-invocation: true` from `how`, `why`, `architect`, `arena`, `swarm`, `interrogate`, `unslop`, `no-comments`, `technical-writing`, `tdd`, `benchmark-checklist`, `blast-radius`, `typescript-best-practices`, `show-me-your-work`, and `figure-it-out`. Preserve it on other skills, including `ketchup`, `in-your-own-words`, and `sharpen`.

The Claude progress mod in `hooks/`, its state contract in `types/`, and the Claude manifests remain port-owned. Cursor model routing and Cursor-only tools remain unported, as described in the README.

Before release, compare every synced file with the pinned source after these transformations, then run the verification commands in `CLAUDE.md`. Run the upstream Bun tests with Bun rather than the Claude mod test runner.
