import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Every directory under root that may carry its own instructions or skills, root included.
 * Skips dot-directories (other checkouts under .ateam/.claude/.git, vendor tool dirs), node_modules,
 * and nested git checkouts (submodules, worktrees), whose own sync is their own business.
 */
export function walkDirs(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, isRoot: boolean) => {
    if (!isRoot && existsSync(join(dir, ".git"))) return;
    out.push(dir);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
      visit(join(dir, e.name), false);
    }
  };
  visit(root, true);
  return out;
}

/** Main checkout root for a path inside a repo or worktree (parent of the common .git dir). Falls back to the path. */
export function repoRoot(path: string): string {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: path, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return dirname(common);
  } catch {
    return path;
  }
}
