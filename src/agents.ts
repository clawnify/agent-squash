import { homedir } from "node:os";
import { join } from "node:path";

export interface AgentConfig {
  name: string;
  displayName: string;
  /** tag used to scope a section of the shared instructions to this agent: <tag> … </tag> */
  tag: string;
  /** extra absolute dirs whose existence means the agent is installed (parents of the global paths always count) */
  detect?: string[];
  /** repo-relative skills dir needing a symlink; undefined = reads .agents/skills natively */
  skillsDir?: string;
  /** absolute global skills dir needing a symlink; undefined = reads ~/.agents/skills natively (or no global skills) */
  globalSkillsDir?: string;
  /** repo-relative instructions file needing a symlink to CLAUDE.md; undefined = reads AGENTS.md natively */
  instructionsFile?: string;
  /** absolute global instructions file needing a symlink to ~/.claude/CLAUDE.md */
  globalInstructionsFile?: string;
}

const home = homedir();

export const UNIVERSAL_SKILLS_DIR = ".agents/skills";
export const UNIVERSAL_INSTRUCTIONS = "AGENTS.md";

/** Claude Code's global config dir (honors CLAUDE_CONFIG_DIR). */
export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
}

/**
 * Every agent we know. Paths are verified against each vendor's docs or the
 * vercel-labs/skills registry — never added from memory (see AGENTS.md).
 *
 *   opencode   https://opencode.ai/docs/rules  https://opencode.ai/docs/skills
 *   codex      https://learn.chatgpt.com/docs/agent-configuration/agents-md  …/build-skills
 *   gemini-cli https://geminicli.com/docs/cli/gemini-md/
 */
export const AGENTS: AgentConfig[] = [
  { name: "claude-code", displayName: "Claude Code", tag: "claude", skillsDir: ".claude/skills", globalSkillsDir: join(claudeHome(), "skills"), instructionsFile: "CLAUDE.md" },
  // Read AGENTS.md + .agents/skills in repos, but have their own global instructions file.
  { name: "opencode", displayName: "OpenCode", tag: "opencode", detect: [join(home, ".opencode"), join(home, ".config/opencode")], globalInstructionsFile: join(home, ".config/opencode/AGENTS.md") },
  { name: "codex", displayName: "Codex", tag: "codex", globalInstructionsFile: join(home, ".codex/AGENTS.md") },
  // Reads GEMINI.md, not AGENTS.md.
  { name: "gemini-cli", displayName: "Gemini CLI", tag: "gemini", skillsDir: ".gemini/skills", globalSkillsDir: join(home, ".gemini/skills"), instructionsFile: "GEMINI.md", globalInstructionsFile: join(home, ".gemini/GEMINI.md") },
  // Long-tail agents with their own skills dir (vercel-labs/skills registry).
  { name: "goose", displayName: "Goose", tag: "goose", skillsDir: ".goose/skills", globalSkillsDir: join(home, ".config/goose/skills") },
  { name: "droid", displayName: "Droid (Factory)", tag: "droid", skillsDir: ".factory/skills", globalSkillsDir: join(home, ".factory/skills") },
  { name: "junie", displayName: "Junie", tag: "junie", skillsDir: ".junie/skills", globalSkillsDir: join(home, ".junie/skills") },
  { name: "roo", displayName: "Roo Code", tag: "roo", skillsDir: ".roo/skills", globalSkillsDir: join(home, ".roo/skills") },
  { name: "trae", displayName: "Trae", tag: "trae", skillsDir: ".trae/skills", globalSkillsDir: join(home, ".trae/skills") },
  { name: "windsurf", displayName: "Windsurf", tag: "windsurf", skillsDir: ".windsurf/skills", globalSkillsDir: join(home, ".codeium/windsurf/skills") },
  { name: "kilo", displayName: "Kilo Code", tag: "kilo", skillsDir: ".kilocode/skills", globalSkillsDir: join(home, ".kilocode/skills") },
  { name: "kiro-cli", displayName: "Kiro CLI", tag: "kiro", skillsDir: ".kiro/skills", globalSkillsDir: join(home, ".kiro/skills") },
  { name: "augment", displayName: "Augment", tag: "augment", skillsDir: ".augment/skills", globalSkillsDir: join(home, ".augment/skills") },
  { name: "crush", displayName: "Crush", tag: "crush", skillsDir: ".crush/skills", globalSkillsDir: join(home, ".config/crush/skills") },
  { name: "devin", displayName: "Devin", tag: "devin", skillsDir: ".devin/skills", globalSkillsDir: join(home, ".config/devin/skills") },
  { name: "qwen-code", displayName: "Qwen Code", tag: "qwen", skillsDir: ".qwen/skills", globalSkillsDir: join(home, ".qwen/skills") },
  { name: "grok", displayName: "Grok Build", tag: "grok", skillsDir: ".grok/skills", globalSkillsDir: join(home, ".grok/skills") },
  { name: "hermes-agent", displayName: "Hermes Agent", tag: "hermes", skillsDir: ".hermes/skills", globalSkillsDir: join(home, ".hermes/skills") },
  { name: "aider-desk", displayName: "AiderDesk", tag: "aider", skillsDir: ".aider-desk/skills", globalSkillsDir: join(home, ".aider-desk/skills") },
  // Fully universal: AGENTS.md + .agents/skills, nothing to link. Listed so their tag is valid.
  { name: "cursor", displayName: "Cursor", tag: "cursor" },
  { name: "copilot", displayName: "GitHub Copilot", tag: "copilot" },
  { name: "amp", displayName: "Amp", tag: "amp" },
  { name: "zed", displayName: "Zed", tag: "zed" },
  { name: "warp", displayName: "Warp", tag: "warp" },
  { name: "cline", displayName: "Cline", tag: "cline" },
  { name: "antigravity", displayName: "Antigravity", tag: "antigravity" },
];

/** Agents that need at least one symlink somewhere (selectable with -a / --all). */
export const LINKED_AGENTS = AGENTS.filter(
  (a) => a.name !== "claude-code" && (a.skillsDir || a.globalSkillsDir || a.instructionsFile || a.globalInstructionsFile)
);

export const KNOWN_TAGS = AGENTS.map((a) => a.tag);
