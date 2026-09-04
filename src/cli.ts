#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { NON_UNIVERSAL_AGENTS, type AgentConfig } from "./agents.js";
import { runSync, check, type Plan } from "./core.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const HELP = `
agentsync — one source of truth for every coding agent

Keeps .claude/ and CLAUDE.md exactly as they are. Adds the universal,
vendor-neutral paths every other agent reads:

  AGENTS.md       -> CLAUDE.md        (Codex, Cursor, Zed, Amp, ... read it natively)
  .agents/skills  -> .claude/skills   (Cursor, Codex, Gemini, Copilot, Zed, ... natively)
  <agent>/skills  -> .agents/skills   (Goose, Roo, Junie, Windsurf, ... via symlink)

Claude Code notices nothing. If a real AGENTS.md already exists, CLAUDE.md
overrides it on first sync (previous content saved as AGENTS.md.bak).

Usage:
  agentsync [options] [path]

Options:
  -g, --global      sync the global scope (~/.claude -> ~/.agents)
  -c, --check       verify existing links instead of creating them (exit 1 on drift)
  -n, --dry-run     show what would happen, change nothing
  -a, --agents x,y  also wire these agents (default: only agents detected on this machine)
      --all         wire every known non-universal agent, detected or not
  -h, --help        show this help
  -v, --version     show version

Agents needing a symlink: ${NON_UNIVERSAL_AGENTS.map((a) => a.displayName).join(", ")}
Universal agents (no symlink needed): Codex, Cursor, Gemini CLI, GitHub Copilot, Amp, Zed, OpenCode, Warp, Cline, Antigravity
`.trimEnd();

/** Pick which non-universal agents to wire. claude-code is never an extra link. */
function selectAgents(all: boolean, only: string[] | undefined): AgentConfig[] {
  let list: AgentConfig[];
  if (all) {
    list = NON_UNIVERSAL_AGENTS;
  } else {
    const home = homedir();
    list = NON_UNIVERSAL_AGENTS.filter(
      (a) => existsSync(join(home, "." + a.name.split("-")[0])) || (a.globalSkillsDir && existsSync(a.globalSkillsDir))
    );
    if (only?.length) {
      const wanted = new Set(only.map((s) => s.toLowerCase()));
      const filtered = NON_UNIVERSAL_AGENTS.filter((a) => wanted.has(a.name) || wanted.has(a.displayName.toLowerCase()));
      const unknown = [...wanted].filter((w) => !NON_UNIVERSAL_AGENTS.some((a) => a.name === w || a.displayName.toLowerCase() === w));
      if (unknown.length) {
        console.error(`unknown agent(s): ${unknown.join(", ")}\nknown: ${NON_UNIVERSAL_AGENTS.map((a) => a.name).join(", ")}`);
        process.exit(2);
      }
      list = [...new Set([...list, ...filtered])];
    }
  }
  return list.filter((a) => a.name !== "claude-code");
}

function print(plan: Plan, dryRun: boolean): void {
  for (const c of plan.changes) {
    const icon = c.kind === "symlink" ? (dryRun ? "◦" : "+") : c.kind === "conflict" ? "!" : "=";
    console.log(` ${icon} ${c.kind === "symlink" ? `link ${c.path} ${c.detail}` : `${c.path}: ${c.detail}`}`);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) return void console.log(HELP);
  if (argv.includes("-v") || argv.includes("--version")) return void console.log(pkg.version);

  const dryRun = argv.includes("-n") || argv.includes("--dry-run");
  const isCheck = argv.includes("-c") || argv.includes("--check");
  const isGlobal = argv.includes("-g") || argv.includes("--global");
  const all = argv.includes("--all");
  const agentsIdx = Math.max(argv.indexOf("-a"), argv.indexOf("--agents"));
  const only = agentsIdx !== -1 ? (argv[agentsIdx + 1] ?? "").split(",").filter(Boolean) : undefined;

  const home = homedir();
  // repo scope: root = positional path ?? cwd; canonical .claude is always inside root
  // global scope: root = home, claude = ~/.claude
  const positional = argv.find((a, i) => !a.startsWith("-") && argv[i - 1] !== "-a" && argv[i - 1] !== "--agents");
  const repoRoot = positional ?? process.cwd();
  const root = isGlobal ? home : repoRoot;
  const claudeDir = isGlobal ? join(home, ".claude") : join(repoRoot, ".claude");

  if (isCheck) {
    const errors = check(root, claudeDir, selectAgents(all, only));
    if (errors.length) {
      console.error(`drift detected (${errors.length}):\n${errors.map((e) => ` ! ${e}`).join("\n")}`);
      process.exit(1);
    }
    console.log("all links in place");
    return;
  }

  const plan = runSync({ root, claudeDir, extraAgents: selectAgents(all, only), dryRun });
  print(plan, dryRun);
  const conflicts = plan.changes.filter((c) => c.kind === "conflict").length;
  const created = plan.changes.filter((c) => c.kind === "symlink").length;
  console.log(`\n${dryRun ? "would " : ""}create ${created} link(s), ${conflicts} conflict(s). Run with -c anytime to verify.`);
  if (conflicts > 0 && !dryRun) process.exitCode = 1;
}

main();
