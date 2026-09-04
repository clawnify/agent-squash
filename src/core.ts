import { existsSync, lstatSync, readlinkSync, mkdirSync, symlinkSync, rmSync, readFileSync, renameSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { UNIVERSAL_SKILLS_DIR, UNIVERSAL_INSTRUCTIONS, type AgentConfig } from "./agents.js";

export interface Change {
  kind: "symlink" | "skip" | "conflict";
  path: string;
  detail: string;
}

export interface Plan {
  changes: Change[];
}

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

/** Create symlink target at linkPath (relative target for clean git diffs). Never touches real files. */
function ensureSymlink(linkPath: string, target: string, dryRun: boolean, changes: Change[]): void {
  if (isCorrectSymlink(linkPath, target)) {
    changes.push({ kind: "skip", path: linkPath, detail: "already linked" });
    return;
  }
  if (isSymlink(linkPath)) {
    const old = readlinkSafe(linkPath);
    if (!dryRun) rmSync(linkPath);
    if (!dryRun) {
      mkdirSync(dirname(linkPath), { recursive: true });
      makeSymlink(relative(dirname(linkPath), target), linkPath, resolve(target));
    }
    changes.push({ kind: "symlink", path: linkPath, detail: `relinked (was -> ${old})` });
    return;
  }
  if (existsSync(linkPath)) {
    changes.push({ kind: "conflict", path: linkPath, detail: "exists and is not a symlink — left untouched" });
    return;
  }
  if (!dryRun) {
    mkdirSync(dirname(linkPath), { recursive: true });
    makeSymlink(relative(dirname(linkPath), target), linkPath, resolve(target));
  }
  changes.push({ kind: "symlink", path: linkPath, detail: `-> ${relative(dirname(linkPath), target)}` });
}

/**
 * Compute (and optionally apply) the sync for one scope (repo or home).
 *
 * Contract: `.claude/` and `CLAUDE.md` are NEVER read for content, moved, or replaced —
 * Claude Code keeps working exactly as before. We only ADD universal paths:
 *
 *   AGENTS.md       -> CLAUDE.md         (Codex, Cursor, Zed, Amp… read it natively)
 *   .agents/skills  -> .claude/skills    (universal agents read .agents/skills natively)
 *   <agent>/skills  -> .agents/skills    (long-tail agents that have their own dir)
 */
export function runSync(opts: {
  root: string;
  claudeDir: string;
  extraAgents: AgentConfig[];
  dryRun: boolean;
}): Plan {
  const changes: Change[] = [];
  const { root, claudeDir, extraAgents, dryRun } = opts;

  const claudeMd = join(root, "CLAUDE.md");
  const claudeSkills = join(claudeDir, "skills");
  const agentsMd = join(root, UNIVERSAL_INSTRUCTIONS);
  const universalSkills = join(root, UNIVERSAL_SKILLS_DIR);

  // Instructions: CLAUDE.md is the source of truth. If a real AGENTS.md already
  // exists, CLAUDE.md overrides it on first sync (previous content kept as
  // AGENTS.md.bak). Never writes into .claude.
  if (existsSync(claudeMd)) {
    if (existsSync(agentsMd) && !isSymlink(agentsMd)) {
      const differs =
        readFileSync(claudeMd, "utf8") !== readFileSync(agentsMd, "utf8");
      if (differs && !dryRun) {
        renameSync(agentsMd, agentsMd + ".bak");
        changes.push({ kind: "symlink", path: agentsMd, detail: "CLAUDE.md overrode AGENTS.md (previous content saved as AGENTS.md.bak)" });
      } else if (!differs) {
        if (!dryRun) rmSync(agentsMd);
        changes.push({ kind: "symlink", path: agentsMd, detail: "AGENTS.md was identical to CLAUDE.md — replaced with symlink" });
      }
    }
    ensureSymlink(agentsMd, claudeMd, dryRun, changes);
  } else {
    changes.push({ kind: "skip", path: agentsMd, detail: "no CLAUDE.md found" });
  }

  // Skills: only add .agents/skills if .claude/skills exists and .agents/skills is not real.
  if (existsSync(claudeSkills)) {
    ensureSymlink(universalSkills, claudeSkills, dryRun, changes);
  } else if (existsSync(universalSkills) && !isSymlink(universalSkills)) {
    changes.push({ kind: "skip", path: UNIVERSAL_SKILLS_DIR, detail: "no .claude/skills; .agents/skills already real (universal-first setup)" });
  } else {
    changes.push({ kind: "skip", path: UNIVERSAL_SKILLS_DIR, detail: "no skills found" });
  }

  // Wire other non-universal agents through the universal dir.
  for (const agent of extraAgents) {
    ensureSymlink(join(root, agent.skillsDir), universalSkills, dryRun, changes);
  }
  return { changes };
}

/** Verify expected links exist and point at the right targets. Returns failing paths. */
export function check(root: string, claudeDir: string, extraAgents: AgentConfig[]): string[] {
  const errors: string[] = [];
  const pairs: Array<[string, string]> = [];
  const claudeMd = join(root, "CLAUDE.md");
  if (existsSync(claudeMd)) pairs.push([join(root, UNIVERSAL_INSTRUCTIONS), claudeMd]);
  const claudeSkills = join(claudeDir, "skills");
  if (existsSync(claudeSkills)) {
    pairs.push([join(root, UNIVERSAL_SKILLS_DIR), claudeSkills]);
    const universal = join(root, UNIVERSAL_SKILLS_DIR);
    for (const agent of extraAgents) pairs.push([join(root, agent.skillsDir), universal]);
  }
  for (const [link, target] of pairs) {
    if (!isCorrectSymlink(link, target)) errors.push(`${link} (expected -> ${target})`);
  }
  return errors;
}
