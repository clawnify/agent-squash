# agent-squash

A tiny CLI that wires every coding agent to one source of truth via symlinks.

## Commands

- `npm run build` — compile src/ → dist/ (tsc)
- `npm test` — node:test suite in test/run.test.mjs (needs build first)

## Model

- `CLAUDE.md`, `.claude/skills` and `.claude/commands` are the real files. `AGENTS.md`,
  `GEMINI.md`, `.agents/skills`, each agent's command dir, and each agent's global files
  are symlinks into them
  (`src/cli.ts` builds the `Layout`, `src/core.ts` executes it).
- Agent-specific rules live inside the shared file, wrapped in that agent's tag
  (`<opencode> … </opencode>`), with a one-line preamble explaining the tags.
  `--check` lints tags (`lintInstructions` in `src/core.ts`) and warns, never fails, on
  skills and commands other agents would drop (`lintSkills`, `lintCommands`).
- Release: push a `v<version>` tag matching package.json; `.github/workflows/release.yml`
  publishes via npm trusted publishing with provenance. No tokens in the repo.
- The only write into `CLAUDE.md` is the one-time merge of a real vendor file
  that would otherwise be shadowed (`mergeInstructions`). The original is kept as `.bak`.

## Rules

- Real files/dirs are never clobbered; conflicts are reported and skipped.
  `--adopt` may *move* skills into `.claude/skills`, never delete or overwrite.
- Agent registry paths (`src/agents.ts`) must be verified against the vendor's
  docs or vercel-labs/skills — never added from memory. Cite the source in the
  comment above the entry.
