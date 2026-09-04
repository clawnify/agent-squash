# AgentSync

A tiny CLI that wires every coding agent to one source of truth via symlinks.

## Commands

- `npm run build` — compile src/ → dist/ (tsc)
- `npm test` — node:test suite in test/run.test.mjs (needs build first)

## Rules

- `.claude/` and `CLAUDE.md` are never modified — links only point *into* them.
- Real files/dirs are never clobbered; conflicts are reported and skipped.
- Agent registry paths must stay verified against vercel-labs/skills
  (src/agents.ts) — don't add paths from memory.
