import {
  existsSync, lstatSync, readlinkSync, mkdirSync, symlinkSync, rmSync, readFileSync, writeFileSync,
  renameSync, readdirSync, rmdirSync, statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { KNOWN_TAGS } from "./agents.js";

export interface Change {
  kind: "symlink" | "skip" | "conflict" | "merge" | "adopt";
  path: string;
  detail: string;
}

export interface Plan {
  changes: Change[];
}

/** A vendor instructions file that should become a symlink to CLAUDE.md. */
export interface InstructionLink {
  path: string;
  /** agent tag to wrap merged content in; undefined for the shared AGENTS.md (no single owner) */
  tag?: string;
}

/** Everything one scope (repo or home) needs linked. Computed by the CLI, executed here. */
export interface Layout {
  claudeMd: string;
  claudeSkills: string;
  claudeCommands: string;
  instructions: InstructionLink[];
  universalSkills: string;
  /** agent skills dirs that should point at universalSkills */
  agentSkills: string[];
  /** agent Markdown command dirs that should point at claudeCommands (no universal dir exists) */
  agentCommands: string[];
}

export interface SyncOptions {
  dryRun: boolean;
  adopt: boolean;
  /** move .claude/commands/<name>.md into .claude/skills/<name>/SKILL.md so agents without commands get them */
  commandsToSkills: boolean;
}

/** Codex stops loading instruction files once the combined chain reaches this. */
export const CODEX_MAX_BYTES = 32 * 1024;
/** OpenCode and Cursor require this shape; OpenCode also requires the name to equal the directory. */
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Codex rejects longer skill names. */
const SKILL_NAME_MAX = 64;

export const PREAMBLE =
  "> Sections wrapped in an agent tag — `<claude>`, `<opencode>`, `<codex>`, … — apply only to that agent. Untagged text applies to every agent.";
const PREAMBLE_MARK = "apply only to that agent";

function lstatSafe(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function isSymlink(path: string): boolean {
  return lstatSafe(path)?.isSymbolicLink() ?? false;
}

function isRealDir(path: string): boolean {
  const st = lstatSafe(path);
  return !!st && st.isDirectory() && !st.isSymbolicLink();
}

function readlinkSafe(path: string): string {
  try {
    return readlinkSync(path);
  } catch {
    return "";
  }
}

function isCorrectSymlink(path: string, target: string): boolean {
  const st = lstatSafe(path);
  if (!st?.isSymbolicLink()) return false;
  return resolve(dirname(path), readlinkSafe(path)) === resolve(target);
}

function makeSymlink(relOrAbs: string, linkPath: string, junctionTarget?: string): void {
  try {
    symlinkSync(relOrAbs, linkPath, "dir");
  } catch {
    // Windows without symlink privilege: directory junction fallback
    symlinkSync(junctionTarget ?? relOrAbs, linkPath, "junction");
  }
}

function link(linkPath: string, target: string): void {
  mkdirSync(dirname(linkPath), { recursive: true });
  makeSymlink(relative(dirname(linkPath), target), linkPath, resolve(target));
}

/**
 * Minimal front matter reader: the `key: value` lines between a leading `---` and the next `---`.
 * Enough for name/description/model checks without a YAML dependency. Returns undefined when the
 * file has no front matter, null when it opens one and never closes it.
 */
export function frontmatter(content: string): Record<string, string> | undefined | null {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return undefined;
  const end = content.indexOf("\n---", 3);
  if (end === -1) return null;
  const out: Record<string, string> = {};
  for (const line of content.slice(4, end).split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Add `key: value` to the front matter, creating one if needed. Leaves an existing key alone. */
function withFrontmatter(content: string, key: string, value: string): string {
  const fm = frontmatter(content);
  if (fm === undefined) return `---\n${key}: ${value}\n---\n\n${content}`;
  if (fm === null || key in fm) return content;
  const end = content.indexOf("\n---", 3);
  return `${content.slice(0, end)}\n${key}: ${value}${content.slice(end)}`;
}

/** True when both paths are files with equal bytes, or dirs whose entries are recursively the same. */
function sameTree(a: string, b: string): boolean {
  const sa = lstatSync(a);
  const sb = lstatSync(b);
  if (sa.isSymbolicLink() || sb.isSymbolicLink()) return resolve(dirname(a), readlinkSafe(a)) === resolve(dirname(b), readlinkSafe(b));
  if (sa.isDirectory() !== sb.isDirectory()) return false;
  if (!sa.isDirectory()) return statSync(a).size === statSync(b).size && readFileSync(a).equals(readFileSync(b));
  const ea = readdirSync(a).sort();
  const eb = readdirSync(b).sort();
  return ea.length === eb.length && ea.every((e, i) => e === eb[i] && sameTree(join(a, e), join(b, e)));
}

/**
 * Move the entries of a real dir into the canonical dir, then remove the (now empty) real dir so it
 * can become a symlink. Entries that are already symlinks into the canonical dir are redundant and
 * simply removed, as is an entry identical to what the canonical dir already holds. Any other name
 * collision aborts the whole adoption (nothing moved).
 */
function adoptDir(realDir: string, canonical: string, dryRun: boolean, changes: Change[]): boolean {
  const canonicalAbs = resolve(canonical);
  const redundant: string[] = [];
  const duplicates: string[] = [];
  const toMove: string[] = [];
  for (const e of readdirSync(realDir)) {
    const p = join(realDir, e);
    if (isSymlink(p) && resolve(dirname(p), readlinkSafe(p)).startsWith(canonicalAbs)) redundant.push(e);
    else toMove.push(e);
  }
  const collisions: string[] = [];
  for (const e of [...toMove]) {
    if (!existsSync(join(canonical, e))) continue;
    if (sameTree(join(realDir, e), join(canonical, e))) {
      toMove.splice(toMove.indexOf(e), 1);
      duplicates.push(e);
    } else collisions.push(e);
  }
  if (collisions.length) {
    changes.push({ kind: "conflict", path: realDir, detail: `cannot adopt — already in ${canonical}: ${collisions.join(", ")}` });
    return false;
  }
  for (const e of redundant) {
    if (!dryRun) rmSync(join(realDir, e));
    changes.push({ kind: "adopt", path: join(realDir, e), detail: "redundant symlink into the canonical dir — removed" });
  }
  for (const e of duplicates) {
    if (!dryRun) rmSync(join(realDir, e), { recursive: true });
    changes.push({ kind: "adopt", path: join(realDir, e), detail: "identical copy of the canonical entry — removed" });
  }
  for (const e of toMove) {
    if (!dryRun) renameSync(join(realDir, e), join(canonical, e));
    changes.push({ kind: "adopt", path: join(realDir, e), detail: `moved -> ${join(canonical, e)}` });
  }
  if (!dryRun) rmdirSync(realDir);
  return true;
}

/** Create symlink target at linkPath (relative target for clean git diffs). Never clobbers real files. */
function ensureSymlink(linkPath: string, target: string, dryRun: boolean, changes: Change[], adopt = false): void {
  if (isCorrectSymlink(linkPath, target)) {
    changes.push({ kind: "skip", path: linkPath, detail: "already linked" });
    return;
  }
  if (isSymlink(linkPath)) {
    const old = readlinkSafe(linkPath);
    if (!dryRun) {
      rmSync(linkPath);
      link(linkPath, target);
    }
    changes.push({ kind: "symlink", path: linkPath, detail: `relinked (was -> ${old})` });
    return;
  }
  if (existsSync(linkPath)) {
    const adoptable = isRealDir(linkPath) && existsSync(target);
    if (adopt && adoptable) {
      if (!adoptDir(linkPath, target, dryRun, changes)) return;
    } else {
      const hint = adoptable ? " — run with --adopt to move its contents into the canonical dir" : "";
      changes.push({ kind: "conflict", path: linkPath, detail: `exists and is not a symlink — left untouched${hint}` });
      return;
    }
  }
  if (!dryRun) link(linkPath, target);
  changes.push({ kind: "symlink", path: linkPath, detail: `-> ${relative(dirname(linkPath), target)}` });
}

/**
 * A real vendor instructions file exists next to CLAUDE.md. Fold its content into CLAUDE.md so
 * nothing is lost, then let it become a symlink. Content from an agent-specific file (e.g.
 * ~/.config/opencode/AGENTS.md) is wrapped in that agent's tag; the shared AGENTS.md has no single
 * owner, so its content is appended untagged. The original is kept as <file>.bak.
 */
function mergeInstructions(claudeMd: string, incoming: InstructionLink, dryRun: boolean, changes: Change[]): void {
  const claude = readFileSync(claudeMd, "utf8");
  const raw = readFileSync(incoming.path, "utf8");
  const body = raw.trim();
  const rel = relative(dirname(claudeMd), incoming.path);

  if (!body || claude === raw) {
    if (!dryRun) rmSync(incoming.path);
    changes.push({ kind: "symlink", path: incoming.path, detail: body ? "identical to CLAUDE.md — replaced with symlink" : "empty — replaced with symlink" });
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const note = `<!-- agent-squash: merged from ${rel} on ${date}. Review: keep, dedupe, or re-tag. -->`;
  const block = incoming.tag ? `<${incoming.tag}>\n${body}\n</${incoming.tag}>` : body;
  let head = claude.trimEnd();
  if (incoming.tag && !head.includes(PREAMBLE_MARK)) head = `${PREAMBLE}\n\n${head}`;
  if (!dryRun) {
    writeFileSync(claudeMd, `${head}\n\n${note}\n${block}\n`);
    renameSync(incoming.path, incoming.path + ".bak");
  }
  changes.push({
    kind: "merge",
    path: incoming.path,
    detail: `content merged into ${claudeMd}${incoming.tag ? ` under <${incoming.tag}>` : ""} (original kept as ${rel}.bak)`,
  });
}

/**
 * Turn flat .claude/commands/<name>.md files into .claude/skills/<name>/SKILL.md so agents that
 * only read skills (Gemini, Codex in a repo, Amp, Copilot) get them too. Claude Code invokes both
 * as /<name>; `disable-model-invocation: true` keeps the command user-triggered as before.
 * Nested commands are left alone: their names differ per agent (/a:b vs a/b), so flatten first.
 */
function commandsToSkills(commandsDir: string, skillsDir: string, dryRun: boolean, changes: Change[]): void {
  if (!existsSync(commandsDir)) return;
  for (const e of readdirSync(commandsDir).sort()) {
    const p = join(commandsDir, e);
    if (isRealDir(p)) {
      changes.push({ kind: "skip", path: p, detail: "nested commands are not converted (names differ across agents) — flatten first" });
      continue;
    }
    if (!e.endsWith(".md") || e.startsWith(".")) continue;
    const name = e.slice(0, -3);
    if (!SKILL_NAME.test(name)) {
      changes.push({ kind: "skip", path: p, detail: `skill names must match ${SKILL_NAME} — rename first` });
      continue;
    }
    const dest = join(skillsDir, name);
    if (existsSync(dest)) {
      changes.push({ kind: "conflict", path: p, detail: `skill ${name} already exists — command left in place (the skill wins in Claude Code anyway)` });
      continue;
    }
    if (!dryRun) {
      mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, "SKILL.md"), withFrontmatter(readFileSync(p, "utf8"), "disable-model-invocation", "true"));
      rmSync(p);
    }
    changes.push({ kind: "adopt", path: p, detail: `converted -> ${join(dest, "SKILL.md")} (still user-invoked only)` });
  }
}

/**
 * Compute (and optionally apply) the sync for one scope.
 *
 * CLAUDE.md, .claude/skills and .claude/commands are the real files. Everything else is a symlink:
 *
 *   AGENTS.md / GEMINI.md / ~/.config/opencode/AGENTS.md / …  -> CLAUDE.md
 *   .agents/skills                                             -> .claude/skills
 *   <agent>/skills                                             -> .agents/skills
 *   <agent>/commands                                           -> .claude/commands
 *
 * The only write into CLAUDE.md is the one-time merge of a real vendor instructions file.
 */
export function runSync(layout: Layout, opts: SyncOptions): Plan {
  const changes: Change[] = [];
  const { dryRun, adopt } = opts;
  const { claudeMd, claudeSkills, claudeCommands, instructions, universalSkills, agentSkills, agentCommands } = layout;

  if (existsSync(claudeMd)) {
    for (const ins of instructions) {
      if (existsSync(ins.path) && !isSymlink(ins.path)) {
        mergeInstructions(claudeMd, ins, dryRun, changes);
        if (dryRun) {
          // the real file is still in the way during a dry run; report the link that would follow
          changes.push({ kind: "symlink", path: ins.path, detail: `-> ${relative(dirname(ins.path), claudeMd)}` });
          continue;
        }
      }
      ensureSymlink(ins.path, claudeMd, dryRun, changes);
    }
  } else {
    changes.push({ kind: "skip", path: claudeMd, detail: "not found — nothing to link instructions to" });
  }

  if (opts.commandsToSkills) commandsToSkills(claudeCommands, claudeSkills, dryRun, changes);

  if (existsSync(claudeSkills)) {
    ensureSymlink(universalSkills, claudeSkills, dryRun, changes, adopt);
    for (const dir of agentSkills) ensureSymlink(dir, universalSkills, dryRun, changes, adopt);
  } else if (existsSync(universalSkills) && !isSymlink(universalSkills)) {
    changes.push({ kind: "skip", path: universalSkills, detail: "no .claude/skills; .agents/skills already real (universal-first setup)" });
  } else {
    changes.push({ kind: "skip", path: universalSkills, detail: "no skills found" });
  }

  if (existsSync(claudeCommands)) {
    for (const dir of agentCommands) ensureSymlink(dir, claudeCommands, dryRun, changes, adopt);
  } else if (agentCommands.length) {
    changes.push({ kind: "skip", path: claudeCommands, detail: "no commands found" });
  }
  return { changes };
}

export interface CheckResult {
  errors: string[];
  warnings: string[];
}

const TAG_LINE = /^<(\/?)([a-z][a-z0-9-]*)>\s*$/;

/** Validate the agent-tag convention inside the shared instructions file. */
export function lintInstructions(content: string, path: string): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const stack: Array<{ tag: string; line: number }> = [];
  let sawTag = false;
  content.split("\n").forEach((raw, i) => {
    const m = TAG_LINE.exec(raw);
    if (!m) return;
    const [, close, tag] = m;
    const line = i + 1;
    if (!KNOWN_TAGS.includes(tag)) {
      errors.push(`${path}:${line}: unknown agent tag <${tag}> (known: ${KNOWN_TAGS.join(", ")})`);
      return;
    }
    sawTag = true;
    if (close) {
      const open = stack.pop();
      if (!open) errors.push(`${path}:${line}: </${tag}> without matching <${tag}>`);
      else if (open.tag !== tag) errors.push(`${path}:${line}: </${tag}> closes <${open.tag}> opened at line ${open.line}`);
    } else {
      if (stack.length) errors.push(`${path}:${line}: <${tag}> nested inside <${stack[stack.length - 1].tag}> — tags cannot nest`);
      stack.push({ tag, line });
    }
  });
  for (const open of stack) errors.push(`${path}:${open.line}: <${open.tag}> is never closed`);
  if (sawTag && !content.includes(PREAMBLE_MARK)) {
    errors.push(`${path}: uses agent tags but has no preamble explaining them — add this line near the top:\n    ${PREAMBLE}`);
  }
  const bytes = Buffer.byteLength(content);
  if (bytes > CODEX_MAX_BYTES) {
    warnings.push(`${path} is ${bytes} bytes; Codex stops loading instruction files once the combined chain passes ${CODEX_MAX_BYTES}`);
  }
  return { errors, warnings };
}

/**
 * Portability warnings for skills: what Claude Code tolerates but other agents silently drop.
 * shortcut: warnings only, so an existing library keeps passing --check; add --strict if CI needs to fail on these.
 */
export function lintSkills(skillsDir: string): string[] {
  const warnings: string[] = [];
  if (!existsSync(skillsDir)) return warnings;
  for (const e of readdirSync(skillsDir).sort()) {
    if (e.startsWith(".")) continue;
    const dir = join(skillsDir, e);
    if (!statSync(dir).isDirectory()) {
      warnings.push(`${dir}: not a directory — agents expect <name>/SKILL.md`);
      continue;
    }
    const skillMd = join(dir, "SKILL.md");
    if (!existsSync(skillMd)) {
      warnings.push(`${dir}: no SKILL.md — skipped by every agent`);
      continue;
    }
    if (!SKILL_NAME.test(e)) warnings.push(`${dir}: name must match ${SKILL_NAME} for OpenCode and Cursor`);
    if (e.length > SKILL_NAME_MAX) warnings.push(`${dir}: name longer than ${SKILL_NAME_MAX} chars — Codex rejects it`);
    const fm = frontmatter(readFileSync(skillMd, "utf8"));
    if (fm === undefined) {
      warnings.push(`${skillMd}: must start with --- front matter — Codex and OpenCode skip it otherwise`);
      continue;
    }
    if (fm === null) {
      warnings.push(`${skillMd}: front matter is never closed`);
      continue;
    }
    if (!fm.name) warnings.push(`${skillMd}: no name — OpenCode requires name: ${e}`);
    else if (fm.name !== e) warnings.push(`${skillMd}: name "${fm.name}" must equal the directory name for OpenCode`);
    if (!fm.description) warnings.push(`${skillMd}: no description — OpenCode and Codex skip it`);
  }
  return warnings;
}

/** Portability warnings for Markdown commands shared with OpenCode, Codex, and Cursor. */
export function lintCommands(commandsDir: string): string[] {
  const warnings: string[] = [];
  if (!existsSync(commandsDir)) return warnings;
  for (const e of readdirSync(commandsDir).sort()) {
    if (e.startsWith(".")) continue;
    const p = join(commandsDir, e);
    if (statSync(p).isDirectory()) {
      warnings.push(`${p}: nested commands are named /${e}:<name> in Claude Code but ${e}/<name> in OpenCode — flatten for consistency`);
      continue;
    }
    if (!e.endsWith(".md")) continue;
    const fm = frontmatter(readFileSync(p, "utf8"));
    if (fm === null) warnings.push(`${p}: front matter is never closed`);
    else if (fm?.model && !fm.model.includes("/")) warnings.push(`${p}: model "${fm.model}" is a Claude alias — OpenCode expects provider/model and fails at run time`);
  }
  return warnings;
}

/** Verify every expected link is in place and the shared files are well-formed. */
export function check(layout: Layout): CheckResult {
  const { claudeMd, claudeSkills, claudeCommands, instructions, universalSkills, agentSkills, agentCommands } = layout;
  const result: CheckResult = { errors: [], warnings: [] };
  const pairs: Array<[string, string]> = [];
  if (existsSync(claudeMd)) {
    for (const ins of instructions) pairs.push([ins.path, claudeMd]);
    const lint = lintInstructions(readFileSync(claudeMd, "utf8"), claudeMd);
    result.errors.push(...lint.errors);
    result.warnings.push(...lint.warnings);
  }
  if (existsSync(claudeSkills)) {
    pairs.push([universalSkills, claudeSkills]);
    for (const dir of agentSkills) pairs.push([dir, universalSkills]);
    result.warnings.push(...lintSkills(claudeSkills));
  }
  if (existsSync(claudeCommands)) {
    for (const dir of agentCommands) pairs.push([dir, claudeCommands]);
    result.warnings.push(...lintCommands(claudeCommands));
  }
  for (const [l, target] of pairs) {
    if (!isCorrectSymlink(l, target)) result.errors.push(`${l} (expected -> ${target})`);
  }
  return result;
}
