# AgentSync

**One source of truth for every coding agent. Zero vendor lock-in.**

You have `CLAUDE.md` and `.claude/skills/`. You want Codex, Cursor, Gemini CLI,
Copilot, Zed, Amp, OpenCode — any agent — to see the same instructions and
skills, without maintaining copies that drift apart.

AgentSync wires the universal, vendor-neutral paths that other agents already
read natively, using symlinks:

```
AGENTS.md        -> CLAUDE.md        # Codex, Cursor, Zed, Amp, ... read AGENTS.md natively
.agents/skills   -> .claude/skills   # Cursor, Codex, Gemini, Copilot, Zed, ... read .agents/skills natively
.goose/skills    -> .agents/skills   # long-tail agents with their own dir get a symlink too
```

## The guarantee

**Claude Code never notices anything.** `.claude/` and `CLAUDE.md` are never
read for content, moved, replaced, or modified. Claude Code keeps working
exactly as before — the tool only *adds* new paths that point into the files
you already have.

If a real `AGENTS.md` already exists in the repo, `CLAUDE.md` overrides it on
first sync (the previous content is saved as `AGENTS.md.bak`). Real directories
that would collide with a symlink are never clobbered — they're reported as
conflicts and left alone.

## Usage

```bash
npx agent-sync                 # sync the current repo
npx agent-sync -g              # sync the global scope (~/.claude -> ~/.agents)
npx agent-sync -a goose,roo    # also wire specific agents
npx agent-sync --all           # wire every known long-tail agent
npx agent-sync -n              # dry-run
npx agent-sync -c              # verify links are intact (exit 1 on drift — CI-friendly)
```

Run it in a repo, commit the symlinks (git tracks them natively), and every
teammate gets the same setup on pull. Run `--check` in CI to catch drift.

## Which agents read what

| | |
|---|---|
| **Read `AGENTS.md` + `.agents/skills` natively** | Codex, Cursor, Gemini CLI, GitHub Copilot, Amp, Zed, OpenCode, Warp, Cline, Antigravity |
| **Get a symlink** | Claude Code (`.claude` — untouched, links point *into* it), Goose, Droid, Junie, Roo, Trae, Windsurf, Kilo, Kiro, Augment, Crush, Devin, Qwen, Grok, Hermes, AiderDesk |

## Notes

- **Windows**: directory symlinks need Developer Mode; AgentSync falls back to
  junctions automatically, which need no privileges.
- The Agent Skills format (`<name>/SKILL.md`) is an open standard — the same
  skill folders work everywhere.
- `AGENTS.md` is stewarded by the Linux Foundation's Agentic AI Foundation.

## License

MIT
