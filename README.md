# agent-squash

**Your coding agents argued over who owns the instructions file. Squash them onto one.**

One source of truth for every coding agent. Symlinks, not copies. Zero vendor lock-in.

You have `CLAUDE.md` and `.claude/skills/`. You want Codex, Cursor, Gemini CLI,
OpenCode, Copilot, Zed, Amp — any agent — to see the same instructions and
skills, without maintaining copies that drift apart.

agent-squash keeps your Claude files as the real ones and makes every path the
other agents read a symlink into them:

```
AGENTS.md        -> CLAUDE.md        # Codex, Cursor, OpenCode, Zed, Amp, ... read AGENTS.md natively
GEMINI.md        -> CLAUDE.md        # Gemini CLI reads only GEMINI.md
.agents/skills   -> .claude/skills   # Codex, Cursor, Gemini, Copilot, Zed, ... read .agents/skills natively
.goose/skills    -> .agents/skills   # long-tail agents with their own dir get a symlink too
```

Add a rule or a skill in Claude and every agent has it. Nothing to regenerate.

## Global scope

Each agent has its own global instructions file, and most of them shadow
`~/.claude/CLAUDE.md` the moment they exist. `agent-squash -g` turns them into links:

```
~/.config/opencode/AGENTS.md  -> ~/.claude/CLAUDE.md
~/.codex/AGENTS.md            -> ~/.claude/CLAUDE.md
~/.gemini/GEMINI.md           -> ~/.claude/CLAUDE.md
~/.agents/skills              -> ~/.claude/skills      # Codex reads it natively; OpenCode reads ~/.claude/skills directly
```

## Rules for one agent only

Everything in the shared file applies to every agent. To scope a section to one
agent, wrap it in that agent's tag and keep the one-line preamble near the top:

```markdown
> Sections wrapped in an agent tag — `<claude>`, `<opencode>`, `<codex>`, … — apply only to that agent. Untagged text applies to every agent.

# Project rules
...

<opencode>
Ask the `help` subagent before guessing.
</opencode>
```

Tags are plain text: OpenCode and Codex read `AGENTS.md` and support no
include syntax, so a scoped section has to live in the shared file. Tags
cannot nest. `--check` fails on an unclosed or unknown tag and on tags without
the preamble. For Claude-only content longer than a few lines, prefer
`.claude/rules/*.md`, which Claude Code loads natively and no other agent sees.

## Merging an existing vendor file

If a real `AGENTS.md`, `GEMINI.md`, or `~/.config/opencode/AGENTS.md` already
exists and differs from `CLAUDE.md`, its content is appended to `CLAUDE.md`
once, under a dated `<!-- agent-squash: merged from ... -->` comment, and the file
becomes a symlink. Content from an agent's own file is wrapped in that agent's
tag; a repo-root `AGENTS.md` has no single owner, so it is appended untagged
for you to review. The original is kept as `.bak`. This is the only write
agent-squash ever makes into `CLAUDE.md`.

## Usage

```bash
npx agent-squash                 # sync the current repo
npx agent-squash -g              # sync the global scope
npx agent-squash -a goose,roo    # also wire specific agents (default: agents detected on this machine)
npx agent-squash --all           # wire every known agent
npx agent-squash --adopt         # move skills out of a real dir that blocks a link, then link it
npx agent-squash -n              # dry-run
npx agent-squash -c              # verify links and tag syntax (exit 1 on drift — CI-friendly)
```

Run it in a repo, commit the symlinks (git tracks them natively), and every
teammate gets the same setup on pull. Run `--check` in CI to catch drift.

`--check` also warns when `CLAUDE.md` passes 32 KiB, the point where Codex stops
loading instruction files.

## The guarantee

`CLAUDE.md` and `.claude/` stay real and stay where they are. Claude Code
notices nothing, and can still edit its own file (it refuses to write through a
symlink). Real files and directories are never clobbered: a directory in a
link's way is reported as a conflict and left alone unless you pass `--adopt`,
which *moves* its skills into `.claude/skills` and refuses on any name
collision that isn't an identical copy.

## Which agents read what

| | |
|---|---|
| **Read `AGENTS.md` + `.agents/skills` natively** | Codex, Cursor, GitHub Copilot, Amp, Zed, OpenCode, Warp, Cline, Antigravity |
| **Own global instructions file** | OpenCode (`~/.config/opencode/AGENTS.md`), Codex (`~/.codex/AGENTS.md`), Gemini CLI (`~/.gemini/GEMINI.md`) |
| **Own instructions filename** | Gemini CLI (`GEMINI.md`) |
| **Own skills dir (symlinked)** | Gemini CLI, Goose, Droid, Junie, Roo, Trae, Windsurf, Kilo, Kiro, Augment, Crush, Devin, Qwen, Grok, Hermes, AiderDesk |

## Notes

- **Windows**: directory symlinks need Developer Mode; agent-squash falls back to
  junctions automatically, which need no privileges. Git needs `core.symlinks=true`.
- The Agent Skills format (`<name>/SKILL.md`) is an open standard — the same
  skill folders work everywhere. OpenCode validates only `name` and `description`,
  so Claude-only frontmatter fields should pass through; not verified for every agent.
- `AGENTS.md` is stewarded by the Linux Foundation's Agentic AI Foundation.

## License

MIT
