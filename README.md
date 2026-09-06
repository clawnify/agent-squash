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
.opencode/commands -> .claude/commands  # Markdown slash commands: OpenCode, Cursor
```

Add a rule or a skill in Claude and every agent has it. Nothing to regenerate.

## Monorepos: every directory, both directions

Instruction files apply per directory, and in a large repo it only takes one directory
with a `CLAUDE.md` and no `AGENTS.md` (or the reverse) for half the team to work
without rules. agent-squash walks the whole tree. Every directory that has one of the
two files gets the other as a link, whichever exists is the real one, and `--check`
fails on any directory that has one without the other:

```
packages/api/CLAUDE.md          real   ->  packages/api/AGENTS.md links to it
packages/web/AGENTS.md          real   ->  packages/web/CLAUDE.md links to it
```

Nested `.claude/skills` get their `.agents/skills` link too. Dot-directories,
`node_modules`, and nested git checkouts are left alone. Claude Code cannot edit a
file through a symlink, so in an `AGENTS.md`-first directory ask it to edit `AGENTS.md`.

## Global scope

Each agent has its own global instructions file, and most of them shadow
`~/.claude/CLAUDE.md` the moment they exist. `agent-squash -g` turns them into links:

```
~/.config/opencode/AGENTS.md  -> ~/.claude/CLAUDE.md
~/.codex/AGENTS.md            -> ~/.claude/CLAUDE.md
~/.gemini/GEMINI.md           -> ~/.claude/CLAUDE.md
~/.agents/skills              -> ~/.claude/skills      # Codex and Gemini read it natively; OpenCode reads ~/.claude/skills directly
~/.config/opencode/commands   -> ~/.claude/commands
~/.codex/prompts              -> ~/.claude/commands    # Codex custom prompts, invoked as /prompts:name
```

## Slash commands

There is no universal commands directory, but OpenCode, Cursor, and Codex read the
same Markdown-with-front-matter files Claude Code does, with the same `$ARGUMENTS`
and `$1` placeholders. Their command dirs are linked straight to `.claude/commands`.
OpenCode ignores front matter keys it does not know, such as `allowed-tools`.

Two caveats. Nested commands are named differently per agent (`/git:commit` in Claude
Code, `git/commit` in OpenCode), so keep them flat. And every vendor is steering
commands toward skills: Claude Code calls `.claude/commands` legacy, Codex marks
custom prompts deprecated, Amp removed them. To reach the agents that only read
skills (Gemini, Codex inside a repo, Amp, Copilot), run:

```bash
npx agent-squash --commands-to-skills   # .claude/commands/deploy.md -> .claude/skills/deploy/SKILL.md
```

Each converted command keeps `/deploy` in Claude Code and gets
`disable-model-invocation: true` so it stays user-triggered. Commands whose name
clashes with an existing skill, or that sit in a subdirectory, are left alone.

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
for you to review. The original is kept as `.bak`.

A `CLAUDE.md` that already imports `AGENTS.md` with `@AGENTS.md`, Claude Code's
documented alternative to a link, is recognised and left alone: `AGENTS.md` is treated
as the real file and only vendor files such as `GEMINI.md` are linked to it. This is the only write
agent-squash ever makes into `CLAUDE.md`.

## Shared local memory

Claude Code keeps auto memory per project: a `MEMORY.md` index plus one Markdown file
per note, written by Claude as it learns. That format is plain enough to be the local
memory every agent shares. Opt in per repo:

```bash
npx agent-squash --memory
```

This uses Claude Code's documented `autoMemoryDirectory` setting rather than guessing
where Claude keeps the files (that path is undocumented and has changed):

```
.claude/settings.json     autoMemoryDirectory: "~/.agents/memory/<repo>"   committed; same on every machine and worktree
~/.agents/memory/<repo>   the store; existing Claude memory is moved here if found
.agents/memory            -> the store; gitignored, since the target is machine-specific
CLAUDE.md                 one marked block telling agents to read MEMORY.md and add notes
```

Claude Code loads the index automatically. Every other agent gets the block through
the shared instructions and reads or writes the same files. Once set up, plain
`npx agent-squash` maintains it and `--check` enforces it. Committing the setting
relocates teammates' Claude memory for this repo too, which is why it is opt-in.

Not covered: Codex's own SQLite memory and Cursor's cloud memory stay where they are,
and a remote memory service is an MCP server you configure once per harness.

## Usage

```bash
npx agent-squash                 # sync the current repo
npx agent-squash -g              # sync the global scope
npx agent-squash -a goose,roo    # also wire specific agents (default: agents detected on this machine)
npx agent-squash --all           # wire every known agent
npx agent-squash --adopt         # move skills/commands out of a real dir that blocks a link, then link it
npx agent-squash --commands-to-skills   # turn flat commands into skills for agents without commands
npx agent-squash --memory        # share Claude's local auto memory with every agent (repo scope)
npx agent-squash -n              # dry-run
npx agent-squash -c              # verify links and tag syntax (exit 1 on drift — CI-friendly)
```

Run it in a repo, commit the symlinks (git tracks them natively), and every
teammate gets the same setup on pull. Run `--check` in CI to catch drift.

`--check` also warns, without failing, about things Claude Code accepts but other
agents silently drop: a skill without `name` or `description`, a SKILL.md that does
not start with front matter, a name that is not lowercase-hyphen or differs from its
directory, a command with a bare `model: opus` alias, and a `CLAUDE.md` past 32 KiB,
where Codex stops loading instruction files.

## The guarantee

`CLAUDE.md` and `.claude/` stay real and stay where they are. Claude Code
notices nothing, and can still edit its own file (it refuses to write through a
symlink). The two exceptions are opt-in and documented: the one-time merge of a
vendor file into `CLAUDE.md`, and `--memory`, which writes one setting to
`.claude/settings.json`. Real files and directories are never clobbered: a directory in a
link's way is reported as a conflict and left alone unless you pass `--adopt`,
which *moves* its skills into `.claude/skills` and refuses on any name
collision that isn't an identical copy.

## Which agents read what

| | |
|---|---|
| **Read `AGENTS.md` + `.agents/skills` natively** | Codex, Cursor, GitHub Copilot, Amp, Zed, OpenCode, Warp, Cline, Antigravity. Gemini reads `.agents/skills` but needs `GEMINI.md` |
| **Own global instructions file** | OpenCode (`~/.config/opencode/AGENTS.md`), Codex (`~/.codex/AGENTS.md`), Gemini CLI (`~/.gemini/GEMINI.md`) |
| **Own instructions filename** | Gemini CLI (`GEMINI.md`) |
| **Markdown commands (linked)** | OpenCode (`.opencode/commands`), Cursor (`.cursor/commands`), Codex (`~/.codex/prompts`, global only) |
| **Own skills dir (symlinked)** | Goose, Droid, Junie, Roo, Trae, Windsurf, Kilo, Kiro, Augment, Crush, Devin, Qwen, Grok, Hermes, AiderDesk |

## Notes

- **Windows**: directory symlinks need Developer Mode; agent-squash falls back to
  junctions automatically, which need no privileges. Git needs `core.symlinks=true`.
- **OpenCode sees skills twice.** It scans both `.claude/skills` and `.agents/skills`, so
  with the link it finds every skill in two places, logs a duplicate internally, and keeps
  one. Harmless. If you want a single scan, OpenCode's own switch
  `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` turns off its `.claude` scan, but then it
  ignores `.claude/skills` in repos you have not synced. `--check` reminds you of this
  once when OpenCode is detected.
- The Agent Skills format (`<name>/SKILL.md`) is an open standard — the same
  skill folders work everywhere. OpenCode validates only `name` and `description`,
  so Claude-only frontmatter fields should pass through; not verified for every agent.
- `AGENTS.md` is stewarded by the Linux Foundation's Agentic AI Foundation.

## License

MIT
