# agent-squash

A tiny CLI that wires every coding agent to one source of truth via symlinks.

## Commands

- `npm run build` — compile src/ → dist/ (tsc)
- `npm test` — node:test suite in test/run.test.mjs (needs build first)

## Model

- `CLAUDE.md` and `.claude/skills` are the real files. `AGENTS.md`, `GEMINI.md`,
  `.agents/skills`, and each agent's global files are symlinks into them
  (`src/cli.ts` builds the `Layout`, `src/core.ts` executes it).
- Agent-specific rules live inside the shared file, wrapped in that agent's tag
  (`<opencode> … </opencode>`), with a one-line preamble explaining the tags.
  `--check` lints tags (`lintInstructions` in `src/core.ts`).
- The only write into `CLAUDE.md` is the one-time merge of a real vendor file
  that would otherwise be shadowed (`mergeInstructions`). The original is kept as `.bak`.

## Rules

- Real files/dirs are never clobbered; conflicts are reported and skipped.
  `--adopt` may *move* skills into `.claude/skills`, never delete or overwrite.
- Agent registry paths (`src/agents.ts`) must be verified against the vendor's
  docs or vercel-labs/skills — never added from memory. Cite the source in the
  comment above the entry.
