import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, appendFileSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { claudeHome } from "./agents.js";
import type { Change } from "./core.js";

/**
 * Shared local memory: Claude Code's own auto memory, relocated with its documented
 * `autoMemoryDirectory` setting to a stable home-relative path every worktree and every
 * teammate's machine resolves the same way, then linked into the checkout as .agents/memory so
 * every other agent reads and writes the same Markdown files.
 *
 *   .claude/settings.json   autoMemoryDirectory: "~/.agents/memory/<repo>"   (committed, documented)
 *   .agents/memory          -> ~/.agents/memory/<repo>                        (machine-specific, gitignored)
 *   CLAUDE.md               one marked block telling agents to read and write it
 */
export interface MemoryLayout {
  settingsFile: string;
  settingValue: string;
  target: string;
  link: string;
  gitignore: string;
  instructions: string;
  /** Claude's current per-project memory dirs that may hold memory worth migrating */
  migrateFrom: string[];
}

export const MEMORY_KEY = "autoMemoryDirectory";
const BLOCK_START = "<!-- agent-squash:memory -->";
const BLOCK_END = "<!-- /agent-squash:memory -->";

export function memoryBlock(): string {
  return `${BLOCK_START}
## Shared local memory

Notes learned in earlier sessions live in \`.agents/memory/\`: a \`MEMORY.md\` index with one
line per note, plus one Markdown topic file per note. Claude Code loads the index automatically.
Other agents: read \`.agents/memory/MEMORY.md\` at the start of a session. When you learn
something durable that the code cannot tell you, add a topic file and one index line.
${BLOCK_END}`;
}

export function memoryLayout(checkout: string, mainRoot: string, instructions: string): MemoryLayout {
  const name = basename(mainRoot);
  const home = homedir();
  // Claude names project dirs from the repo path with separators replaced; the rule has changed
  // across versions, so try the variants seen in the wild. Best effort, read-only until a match.
  const slugs = [...new Set([mainRoot.replace(/\//g, "-"), mainRoot.replace(/[\/.]/g, "-")])];
  return {
    settingsFile: join(checkout, ".claude/settings.json"),
    settingValue: `~/.agents/memory/${name}`,
    target: join(home, ".agents/memory", name),
    link: join(checkout, ".agents/memory"),
    gitignore: join(checkout, ".gitignore"),
    instructions,
    migrateFrom: slugs.map((s) => join(claudeHome(), "projects", s, "memory")).filter((p) => existsSync(p)),
  };
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** The pieces that are not symlinks: the setting, the gitignore line, the instruction block, migration. */
export function applyMemory(m: MemoryLayout, dryRun: boolean, changes: Change[]): { ok: boolean } {
  const settings = readJson(m.settingsFile);
  const current = settings[MEMORY_KEY];
  if (current !== undefined && current !== m.settingValue) {
    changes.push({ kind: "conflict", path: m.settingsFile, detail: `${MEMORY_KEY} is already "${String(current)}" — left untouched; remove it to let agent-squash manage memory` });
    return { ok: false };
  }
  if (current === undefined) {
    if (!dryRun) {
      mkdirSync(join(m.settingsFile, ".."), { recursive: true });
      writeFileSync(m.settingsFile, JSON.stringify({ ...settings, [MEMORY_KEY]: m.settingValue }, null, 2) + "\n");
    }
    changes.push({ kind: "merge", path: m.settingsFile, detail: `${MEMORY_KEY}: "${m.settingValue}" (Claude Code's documented setting; commit it so every worktree and teammate uses the same layout)` });
  } else {
    changes.push({ kind: "skip", path: m.settingsFile, detail: `${MEMORY_KEY} already set` });
  }

  if (!existsSync(m.target)) {
    if (!dryRun) mkdirSync(m.target, { recursive: true });
    changes.push({ kind: "symlink", path: m.target, detail: "created (memory store)" });
  }
  const targetEmpty = !existsSync(m.target) || readdirSync(m.target).length === 0;
  for (const from of m.migrateFrom) {
    const entries = existsSync(from) ? readdirSync(from) : [];
    if (!entries.length) continue;
    if (!targetEmpty) {
      changes.push({ kind: "conflict", path: from, detail: `has ${entries.length} memory file(s) but ${m.target} is not empty — merge by hand` });
      continue;
    }
    for (const e of entries) {
      if (!dryRun) renameSync(join(from, e), join(m.target, e));
      changes.push({ kind: "adopt", path: join(from, e), detail: `moved -> ${join(m.target, e)}` });
    }
  }

  const ignore = existsSync(m.gitignore) ? readFileSync(m.gitignore, "utf8") : "";
  if (!ignore.split("\n").some((l) => l.trim() === ".agents/memory" || l.trim() === "/.agents/memory" || l.trim() === ".agents/memory/")) {
    if (!dryRun) appendFileSync(m.gitignore, `${ignore.length && !ignore.endsWith("\n") ? "\n" : ""}.agents/memory\n`);
    changes.push({ kind: "merge", path: m.gitignore, detail: "+ .agents/memory (the link target is machine-specific)" });
  }

  if (existsSync(m.instructions)) {
    const text = readFileSync(m.instructions, "utf8");
    if (!text.includes(BLOCK_START)) {
      if (!dryRun) writeFileSync(m.instructions, `${text.trimEnd()}\n\n${memoryBlock()}\n`);
      changes.push({ kind: "merge", path: m.instructions, detail: "shared-memory block appended (tells every agent where the notes are)" });
    }
  } else {
    changes.push({ kind: "conflict", path: m.instructions, detail: "no instructions file to tell other agents about .agents/memory" });
  }
  return { ok: true };
}

/** Is memory wired for this checkout? Only then does --check enforce it. */
export function memoryEnabled(m: MemoryLayout): boolean {
  return readJson(m.settingsFile)[MEMORY_KEY] !== undefined;
}

export function checkMemory(m: MemoryLayout): string[] {
  const errors: string[] = [];
  const value = readJson(m.settingsFile)[MEMORY_KEY];
  if (value !== m.settingValue) errors.push(`${m.settingsFile}: ${MEMORY_KEY} is "${String(value)}", expected "${m.settingValue}"`);
  if (!existsSync(m.target)) errors.push(`${m.target}: memory store missing`);
  const ignore = existsSync(m.gitignore) ? readFileSync(m.gitignore, "utf8") : "";
  if (!/^\/?\.agents\/memory\/?$/m.test(ignore)) errors.push(`${m.gitignore}: missing .agents/memory (link target is machine-specific)`);
  if (!existsSync(m.instructions) || !readFileSync(m.instructions, "utf8").includes(BLOCK_START)) errors.push(`${m.instructions}: shared-memory block missing`);
  return errors;
}
