import { homedir } from "node:os";
import { join } from "node:path";

export interface AgentConfig {
  name: string;
  displayName: string;
  /** repo-relative skills dir; ".agents/skills" means the agent reads the universal dir natively */
  skillsDir: string;
  /** absolute global skills dir; undefined = no global skills support */
  globalSkillsDir: string | undefined;
  /** extra vendor instructions filename to symlink to AGENTS.md (e.g. GEMINI.md) */
  instructionsFile?: string;
}

const home = homedir();

/** Agents that read `.agents/skills` natively — no symlink needed. */
export const UNIVERSAL_SKILLS_DIR = ".agents/skills";
export const UNIVERSAL_INSTRUCTIONS = "AGENTS.md";

/**
 * Agents that need a symlink from their own skills dir to the universal one.
 * Paths verified against vercel-labs/skills agent registry (community-maintained).
 */
export const NON_UNIVERSAL_AGENTS: AgentConfig[] = [
  { name: "claude-code", displayName: "Claude Code", skillsDir: ".claude/skills", globalSkillsDir: join(process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude"), "skills"), instructionsFile: "CLAUDE.md" },
  { name: "gemini-cli", displayName: "Gemini CLI", skillsDir: ".gemini/skills", globalSkillsDir: join(home, ".gemini/skills"), instructionsFile: "GEMINI.md" },
  { name: "goose", displayName: "Goose", skillsDir: ".goose/skills", globalSkillsDir: join(home, ".config/goose/skills") },
  { name: "droid", displayName: "Droid (Factory)", skillsDir: ".factory/skills", globalSkillsDir: join(home, ".factory/skills") },
  { name: "junie", displayName: "Junie", skillsDir: ".junie/skills", globalSkillsDir: join(home, ".junie/skills") },
  { name: "roo", displayName: "Roo Code", skillsDir: ".roo/skills", globalSkillsDir: join(home, ".roo/skills") },
  { name: "trae", displayName: "Trae", skillsDir: ".trae/skills", globalSkillsDir: join(home, ".trae/skills") },
  { name: "windsurf", displayName: "Windsurf", skillsDir: ".windsurf/skills", globalSkillsDir: join(home, ".codeium/windsurf/skills") },
  { name: "kilo", displayName: "Kilo Code", skillsDir: ".kilocode/skills", globalSkillsDir: join(home, ".kilocode/skills") },
  { name: "kiro-cli", displayName: "Kiro CLI", skillsDir: ".kiro/skills", globalSkillsDir: join(home, ".kiro/skills") },
  { name: "augment", displayName: "Augment", skillsDir: ".augment/skills", globalSkillsDir: join(home, ".augment/skills") },
  { name: "crush", displayName: "Crush", skillsDir: ".crush/skills", globalSkillsDir: join(home, ".config/crush/skills") },
  { name: "devin", displayName: "Devin", skillsDir: ".devin/skills", globalSkillsDir: join(home, ".config/devin/skills") },
  { name: "qwen-code", displayName: "Qwen Code", skillsDir: ".qwen/skills", globalSkillsDir: join(home, ".qwen/skills") },
  { name: "grok", displayName: "Grok Build", skillsDir: ".grok/skills", globalSkillsDir: join(home, ".grok/skills") },
  { name: "hermes-agent", displayName: "Hermes Agent", skillsDir: ".hermes/skills", globalSkillsDir: join(home, ".hermes/skills") },
  { name: "aider-desk", displayName: "AiderDesk", skillsDir: ".aider-desk/skills", globalSkillsDir: join(home, ".aider-desk/skills") },
];

/** Claude Code's global config dir (honors CLAUDE_CONFIG_DIR). */
export function claudeHome(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(home, ".claude");
}

/** Global canonical location. */
export function globalRoot(): { instructions: string; skills: string } {
  return {
    instructions: join(home, ".agents/AGENTS.md"),
    skills: join(home, ".agents/skills"),
  };
}
