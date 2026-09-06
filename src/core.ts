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
  instructions: InstructionLink[];
  universalSkills: string;
  /** agent skills dirs that should point at universalSkills */
  agentSkills: string[];
}

/** Codex stops loading instruction files once the combined chain reaches this. */
export const CODEX_MAX_BYTES = 32 * 1024;

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
 * Move the skills inside a real dir into the canonical dir, then remove the (now empty) real dir
 * so it can become a symlink. Entries that are already symlinks into the canonical dir are
 * redundant and simply removed, as is an entry identical to what the canonical dir already holds.
 * Any other name collision aborts the whole adoption (nothing moved).
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
    changes.push({ kind: "adopt", path: join(realDir, e), detail: "identical copy of the canonical skill — removed" });
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
 * Compute (and optionally apply) the sync for one scope.
 *
 * CLAUDE.md and .claude/skills are the real files. Everything else is a symlink into them:
 *
 *   AGENTS.md / GEMINI.md / ~/.config/opencode/AGENTS.md / …  -> CLAUDE.md
 *   .agents/skills                                             -> .claude/skills
 *   <agent>/skills                                             -> .agents/skills
 *
 * The only write into CLAUDE.md is the one-time merge of a real vendor instructions file.
 */
export function runSync(layout: Layout, opts: { dryRun: boolean; adopt: boolean }): Plan {
  const changes: Change[] = [];
  const { dryRun, adopt } = opts;
  const { claudeMd, claudeSkills, instructions, universalSkills, agentSkills } = layout;

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

  if (existsSync(claudeSkills)) {
    ensureSymlink(universalSkills, claudeSkills, dryRun, changes, adopt);
    for (const dir of agentSkills) ensureSymlink(dir, universalSkills, dryRun, changes, adopt);
  } else if (existsSync(universalSkills) && !isSymlink(universalSkills)) {
    changes.push({ kind: "skip", path: universalSkills, detail: "no .claude/skills; .agents/skills already real (universal-first setup)" });
  } else {
    changes.push({ kind: "skip", path: universalSkills, detail: "no skills found" });
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

/** Verify every expected link is in place and the instructions file is well-formed. */
export function check(layout: Layout): CheckResult {
  const { claudeMd, claudeSkills, instructions, universalSkills, agentSkills } = layout;
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
  }
  for (const [l, target] of pairs) {
    if (!isCorrectSymlink(l, target)) result.errors.push(`${l} (expected -> ${target})`);
  }
  return result;
}
