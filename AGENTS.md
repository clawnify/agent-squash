# agent-squash

A tiny CLI that wires every coding agent to one source of truth via symlinks.

## Commands

- `npm run build` — compile src/ → dist/ (tsc)
- `npm test` — node:test suite in test/run.test.mjs (needs build first)

## Model

- Whichever of `CLAUDE.md`/`AGENTS.md` (and `.claude/skills`/`.agents/skills`) is real is
  the source; the other, plus vendor files, link to it. Applied to every directory in the
  tree (`src/tree.ts` walks; `src/cli.ts` builds the `Layout`; `src/core.ts` executes it).
- `--memory` (`src/memory.ts`) relocates Claude's auto memory via its documented
  `autoMemoryDirectory` setting and links it as `.agents/memory`. Never guess Claude's
  per-project directory name; it is undocumented and has changed.
- Agent-specific rules live inside the shared file, wrapped in that agent's tag
  (`<opencode> … </opencode>`), with a one-line preamble explaining the tags.
  `--check` lints tags (`lintInstructions` in `src/core.ts`) and warns, never fails, on
  skills and commands other agents would drop (`lintSkills`, `lintCommands`).
- Release: push a `v<version>` tag matching package.json; `.github/workflows/release.yml`
  publishes via npm trusted publishing with provenance. No tokens in the repo.
- Writes into Claude's files are limited to: the one-time merge of a real vendor file
  (`mergeInstructions`, original kept as `.bak`), the shared-memory block, and the
  `autoMemoryDirectory` setting. All opt-in or one-time, all idempotent.

## Rules

- Real files/dirs are never clobbered; conflicts are reported and skipped.
  `--adopt` may *move* skills into `.claude/skills`, never delete or overwrite.
- Agent registry paths (`src/agents.ts`) must be verified against the vendor's
  docs or vercel-labs/skills — never added from memory. Cite the source in the
  comment above the entry.
