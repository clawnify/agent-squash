#!/usr/bin/env node
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { AGENTS, LINKED_AGENTS, UNIVERSAL_INSTRUCTIONS, UNIVERSAL_SKILLS_DIR, claudeHome, type AgentConfig } from "./agents.js";
import { runSync, check, type Layout, type Plan, type InstructionSet, type SkillSet } from "./core.js";
import { walkDirs, repoRoot } from "./tree.js";
import { memoryLayout } from "./memory.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const HELP = `
agent-squash — your coding agents argued over the instructions file. Squash them onto one.

CLAUDE.md and .claude/skills stay the real files. Everything else becomes a
symlink into them, so a rule or skill added in Claude reaches every agent.
Every directory in the tree is covered, so a nested AGENTS.md or CLAUDE.md
always has its twin (a directory with only AGENTS.md gets CLAUDE.md -> AGENTS.md):

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
      --memory      share Claude Code's local auto memory with every agent via .agents/memory
                    (sets autoMemoryDirectory in .claude/settings.json; repo scope only)
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

const isLink = (p: string) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
const isReal = (p: string) => existsSync(p) && !isLink(p);

/** Claude Code's documented alternative to a link: a CLAUDE.md whose content imports AGENTS.md. */
const IMPORTS_AGENTS_MD = /^@(\.\/)?AGENTS\.md\s*$/m;

/**
 * Whichever of CLAUDE.md / AGENTS.md is real is the source; the other, plus vendor files, link to it.
 * A real CLAUDE.md that imports AGENTS.md is already unified: AGENTS.md is the source and CLAUDE.md
 * is left alone, since replacing it would make it import itself.
 */
function instructionSet(dir: string, agents: AgentConfig[]): InstructionSet | undefined {
  const claude = join(dir, "CLAUDE.md");
  const agentsMd = join(dir, UNIVERSAL_INSTRUCTIONS);
  if (!existsSync(claude) && !existsSync(agentsMd)) return undefined;
  let set: InstructionSet;
  if (isReal(claude) && isReal(agentsMd) && IMPORTS_AGENTS_MD.test(readFileSync(claude, "utf8"))) {
    set = { source: agentsMd, links: [], note: "CLAUDE.md imports AGENTS.md — already one source, left as is" };
  } else {
    set = isReal(claude) || !isReal(agentsMd) ? { source: claude, links: [{ path: agentsMd }] } : { source: agentsMd, links: [{ path: claude }] };
  }
  for (const a of agents) if (a.instructionsFile) set.links.push({ path: join(dir, a.instructionsFile), tag: a.tag });
  return set;
}

function skillSet(dir: string, agentDirs: string[]): SkillSet | undefined {
  const claude = join(dir, ".claude/skills");
  const universal = join(dir, UNIVERSAL_SKILLS_DIR);
  if (!existsSync(claude) && !existsSync(universal)) return undefined;
  const claudeIsSource = isReal(claude) || !isReal(universal);
  return { source: claudeIsSource ? claude : universal, link: claudeIsSource ? universal : claude, universal, agentDirs };
}

function repoLayout(root: string, agents: AgentConfig[], wantMemory: boolean): Layout {
  const instructionSets: InstructionSet[] = [];
  const skillSets: SkillSet[] = [];
  for (const dir of walkDirs(root)) {
    const ins = instructionSet(dir, agents);
    if (ins) instructionSets.push(ins);
    const sk = skillSet(dir, dir === root ? agents.filter((a) => a.skillsDir).map((a) => join(root, a.skillsDir!)) : []);
    if (sk) skillSets.push(sk);
  }
  const rootInstructions = instructionSets.find((s) => join(root, "CLAUDE.md") === s.source || join(root, UNIVERSAL_INSTRUCTIONS) === s.source)?.source ?? join(root, "CLAUDE.md");
  return {
    instructionSets,
    skillSets,
    claudeCommands: join(root, ".claude/commands"),
    agentCommands: agents.filter((a) => a.commandsDir).map((a) => join(root, a.commandsDir!)),
    agentNames: agents.map((a) => a.name),
    memory: wantMemory || existsSync(join(root, ".claude/settings.json")) ? memoryLayout(root, repoRoot(root), rootInstructions) : undefined,
  };
}

function globalLayout(agents: AgentConfig[]): Layout {
  const home = homedir();
  const claudeMd = join(claudeHome(), "CLAUDE.md");
  const claudeSkills = join(claudeHome(), "skills");
  return {
    instructionSets: existsSync(claudeMd)
      ? [{ source: claudeMd, links: agents.filter((a) => a.globalInstructionsFile).map((a) => ({ path: a.globalInstructionsFile!, tag: a.tag })) }]
      : [],
    skillSets: existsSync(claudeSkills)
      ? [{ source: claudeSkills, link: join(home, UNIVERSAL_SKILLS_DIR), universal: join(home, UNIVERSAL_SKILLS_DIR), agentDirs: agents.filter((a) => a.globalSkillsDir).map((a) => a.globalSkillsDir!) }]
      : [],
    claudeCommands: join(claudeHome(), "commands"),
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
  const memory = argv.includes("--memory");
  const all = argv.includes("--all");
  const agentsIdx = Math.max(argv.indexOf("-a"), argv.indexOf("--agents"));
  const only = agentsIdx !== -1 ? (argv[agentsIdx + 1] ?? "").split(",").filter(Boolean) : undefined;
  const positional = argv.find((a, i) => !a.startsWith("-") && argv[i - 1] !== "-a" && argv[i - 1] !== "--agents");

  const agents = selectAgents(all, only);
  if (memory && isGlobal) {
    console.error("--memory is per repository (Claude Code keeps auto memory per project); run it inside a repo");
    process.exit(2);
  }
  const layout = isGlobal ? globalLayout(agents) : repoLayout(positional ?? process.cwd(), agents, memory);

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

  const plan = runSync(layout, { dryRun, adopt, commandsToSkills, memory });
  print(plan, dryRun);
  const count = (k: string) => plan.changes.filter((c) => c.kind === k).length;
  const summary = [`${count("symlink")} link(s)`, count("merge") && `${count("merge")} merge(s)`, count("adopt") && `${count("adopt")} adoption(s)`, `${count("conflict")} conflict(s)`].filter(Boolean).join(", ");
  console.log(`\n${dryRun ? "would " : ""}${dryRun ? "make" : "made"}: ${summary}. Run with -c anytime to verify.`);
  if (count("conflict") > 0 && !dryRun) process.exitCode = 1;
}

main();
