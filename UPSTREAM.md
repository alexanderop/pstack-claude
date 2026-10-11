# Upstream sync

This port tracks [Cursor's pstack](https://github.com/cursor/plugins/tree/main/pstack), by Lauren Tan, under its MIT license.

The current source is version **0.15.17**, pinned to repository commit [`9d76bcab133aefcccb16121d7be874e6aa823729`](https://github.com/cursor/plugins/commit/9d76bcab133aefcccb16121d7be874e6aa823729). The Claude Code plugin version is **0.15.17-cc.1**.

## Changes since 0.15.15

- [0.15.16](https://github.com/cursor/plugins/commit/00b14f1df36b32a8dd1529324a3a459f6563b127) shortens workflow prompts, principle prompts, review references, and the PR and trace-forensics playbooks. It retains the workflows while reducing repeated instructions.
- [0.15.17](https://github.com/cursor/plugins/commit/978ca6e9c0e012047cd5058b8e829240336e704e) adds `/ketchup`, a read-only summary of work since the user's last message and any decisions waiting on them. It also adds the skill to `/poteto-help` and the README. In Claude Code, invoke `/pstack:ketchup`.

## Sync scope

Copy `pstack/skills`, `agents`, `docs`, `automations`, and `assets` from the pinned source. Preserve file modes and the MIT license. Keep the Claude introduction above the upstream README. Do not copy Cursor's plugin manifest over `.claude-plugin/plugin.json`.

Apply these existing port adaptations to Markdown files:

- Replace `AskQuestion` with `AskUserQuestion` and `generalPurpose` with `general-purpose`.
- Replace `subagent_type: "poteto-agent"` with `subagent_type: "pstack:poteto-agent"`, and `subagent_type: "Comment Sicko"` with `subagent_type: "pstack:comment-sicko"`.
- Set each skill's frontmatter `name` to its directory name and each agent's `name` to its file stem.
- Remove `is_background: true` from `agents/poteto-agent.md`.
- Remove `disable-model-invocation: true` from `how`, `why`, `architect`, `arena`, `swarm`, `interrogate`, `unslop`, `no-comments`, `technical-writing`, `tdd`, `benchmark-checklist`, `blast-radius`, `typescript-best-practices`, `show-me-your-work`, and `figure-it-out`. Preserve it on other skills, including `ketchup`.

The Claude progress mod in `hooks/`, its state contract in `types/`, and the Claude manifests remain port-owned. Cursor model routing and Cursor-only tools remain unported, as described in the README.

Before release, compare every synced file with the pinned source after these transformations, then run the verification commands in `CLAUDE.md`. Run the upstream Bun tests with Bun rather than the Claude mod test runner.
