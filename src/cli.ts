#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { AGENTS, LINKED_AGENTS, UNIVERSAL_INSTRUCTIONS, UNIVERSAL_SKILLS_DIR, claudeHome, type AgentConfig } from "./agents.js";
import { runSync, check, type Layout, type Plan } from "./core.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const HELP = `
agent-squash — your coding agents argued over the instructions file. Squash them onto one.

CLAUDE.md and .claude/skills stay the real files. Everything else becomes a
symlink into them, so a rule or skill added in Claude reaches every agent:

  AGENTS.md, GEMINI.md          -> CLAUDE.md
  .agents/skills                -> .claude/skills    (Codex, Cursor, Gemini, OpenCode, ... read it natively)
  <agent>/skills                -> .agents/skills    (Goose, Roo, Windsurf, ... via symlink)
  <agent>/commands              -> .claude/commands  (OpenCode, Cursor; Markdown slash commands)

  -g: ~/.config/opencode/AGENTS.md, ~/.codex/AGENTS.md, ~/.gemini/GEMINI.md -> ~/.claude/CLAUDE.md
      ~/.agents/skills -> ~/.claude/skills
      ~/.config/opencode/commands, ~/.codex/prompts -> ~/.claude/commands

If a real vendor file already exists, its content is merged into CLAUDE.md once
(wrapped in that agent's tag when the file belongs to one agent) and kept as .bak.
Scope a section to one agent by wrapping it: <opencode> ... </opencode>.

Usage:
  agent-squash [options] [path]

Options:
  -g, --global      sync the home scope instead of a repo
  -c, --check       verify links and tag syntax (exit 1 on drift — CI-friendly); warns on skills/commands
                    other agents would silently drop
  -n, --dry-run     show what would happen, change nothing
      --adopt       move skills/commands out of a real dir that is in a symlink's way, then link it
      --commands-to-skills
                    turn flat .claude/commands/*.md into skills so agents without commands get them
  -a, --agents x,y  also wire these agents (default: only agents detected on this machine)
      --all         wire every known agent, detected or not
  -h, --help        show this help
  -v, --version     show version

Agents: ${AGENTS.map((a) => a.displayName).join(", ")}
`.trimEnd();

function detected(a: AgentConfig): boolean {
  const dirs = [...(a.detect ?? [])];
  if (a.globalSkillsDir) dirs.push(dirname(a.globalSkillsDir));
  if (a.globalInstructionsFile) dirs.push(dirname(a.globalInstructionsFile));
  return dirs.some((d) => existsSync(d));
}

/** Pick which agents to wire. claude-code is the source, never a link. */
function selectAgents(all: boolean, only: string[] | undefined): AgentConfig[] {
  if (all) return LINKED_AGENTS;
  const list = LINKED_AGENTS.filter(detected);
  if (only?.length) {
    const wanted = new Set(only.map((s) => s.toLowerCase()));
    const match = (a: AgentConfig, w: string) => a.name === w || a.tag === w || a.displayName.toLowerCase() === w;
    const unknown = [...wanted].filter((w) => !LINKED_AGENTS.some((a) => match(a, w)));
    if (unknown.length) {
      console.error(`unknown agent(s): ${unknown.join(", ")}\nknown: ${LINKED_AGENTS.map((a) => a.name).join(", ")}`);
      process.exit(2);
    }
    for (const a of LINKED_AGENTS) if ([...wanted].some((w) => match(a, w)) && !list.includes(a)) list.push(a);
  }
  return list;
}

function repoLayout(root: string, agents: AgentConfig[]): Layout {
  return {
    claudeMd: join(root, "CLAUDE.md"),
    claudeSkills: join(root, ".claude/skills"),
    claudeCommands: join(root, ".claude/commands"),
    instructions: [
      { path: join(root, UNIVERSAL_INSTRUCTIONS) },
      ...agents.filter((a) => a.instructionsFile).map((a) => ({ path: join(root, a.instructionsFile!), tag: a.tag })),
    ],
    universalSkills: join(root, UNIVERSAL_SKILLS_DIR),
    agentSkills: agents.filter((a) => a.skillsDir).map((a) => join(root, a.skillsDir!)),
    agentCommands: agents.filter((a) => a.commandsDir).map((a) => join(root, a.commandsDir!)),
    agentNames: agents.map((a) => a.name),
  };
}

function globalLayout(agents: AgentConfig[]): Layout {
  const home = homedir();
  return {
    claudeMd: join(claudeHome(), "CLAUDE.md"),
    claudeSkills: join(claudeHome(), "skills"),
    claudeCommands: join(claudeHome(), "commands"),
    instructions: agents.filter((a) => a.globalInstructionsFile).map((a) => ({ path: a.globalInstructionsFile!, tag: a.tag })),
    universalSkills: join(home, UNIVERSAL_SKILLS_DIR),
    agentSkills: agents.filter((a) => a.globalSkillsDir).map((a) => a.globalSkillsDir!),
    agentCommands: agents.filter((a) => a.globalCommandsDir).map((a) => a.globalCommandsDir!),
    agentNames: agents.map((a) => a.name),
  };
}

function print(plan: Plan, dryRun: boolean): void {
  const icons = { symlink: dryRun ? "◦" : "+", conflict: "!", skip: "=", merge: "~", adopt: ">" };
  for (const c of plan.changes) {
    const verb = c.kind === "symlink" ? "link " : c.kind === "merge" ? "merge " : c.kind === "adopt" ? "adopt " : "";
    console.log(` ${icons[c.kind]} ${verb}${c.path}${c.kind === "symlink" ? " " : ": "}${c.detail}`);
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) return void console.log(HELP);
  if (argv.includes("-v") || argv.includes("--version")) return void console.log(pkg.version);

  const dryRun = argv.includes("-n") || argv.includes("--dry-run");
  const isCheck = argv.includes("-c") || argv.includes("--check");
  const isGlobal = argv.includes("-g") || argv.includes("--global");
  const adopt = argv.includes("--adopt");
  const commandsToSkills = argv.includes("--commands-to-skills");
  const all = argv.includes("--all");
  const agentsIdx = Math.max(argv.indexOf("-a"), argv.indexOf("--agents"));
  const only = agentsIdx !== -1 ? (argv[agentsIdx + 1] ?? "").split(",").filter(Boolean) : undefined;
  const positional = argv.find((a, i) => !a.startsWith("-") && argv[i - 1] !== "-a" && argv[i - 1] !== "--agents");

  const agents = selectAgents(all, only);
  const layout = isGlobal ? globalLayout(agents) : repoLayout(positional ?? process.cwd(), agents);

  if (isCheck) {
    const { errors, warnings } = check(layout);
    for (const w of warnings) console.error(` ? ${w}`);
    if (errors.length) {
      console.error(`drift detected (${errors.length}):\n${errors.map((e) => ` ! ${e}`).join("\n")}`);
      process.exit(1);
    }
    console.log("all links in place");
    return;
  }

  const plan = runSync(layout, { dryRun, adopt, commandsToSkills });
  print(plan, dryRun);
  const count = (k: string) => plan.changes.filter((c) => c.kind === k).length;
  const summary = [`${count("symlink")} link(s)`, count("merge") && `${count("merge")} merge(s)`, count("adopt") && `${count("adopt")} adoption(s)`, `${count("conflict")} conflict(s)`].filter(Boolean).join(", ");
  console.log(`\n${dryRun ? "would " : ""}${dryRun ? "make" : "made"}: ${summary}. Run with -c anytime to verify.`);
  if (count("conflict") > 0 && !dryRun) process.exitCode = 1;
}

main();
