import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readlinkSync, symlinkSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
const PREAMBLE_MARK = "apply only to that agent";

function tmp(name) {
  return join(mkdtempSync(join(tmpdir(), "agent-squash-")), name);
}

/** A repo with CLAUDE.md and one Claude skill. */
function fixture(name, withSkills = true) {
  const root = tmp(name);
  mkdirSync(join(root, ".claude/skills/foo"), { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), "# claude rules\n");
  if (withSkills) writeFileSync(join(root, ".claude/skills/foo/SKILL.md"), "skill body\n");
  return root;
}

/** A fake home dir: ~/.claude/CLAUDE.md, one skill, OpenCode + Codex installed. */
function homeFixture() {
  const home = tmp("home");
  mkdirSync(join(home, ".claude/skills/foo"), { recursive: true });
  writeFileSync(join(home, ".claude/CLAUDE.md"), "# global claude rules\n");
  writeFileSync(join(home, ".claude/skills/foo/SKILL.md"), "skill body\n");
  mkdirSync(join(home, ".config/opencode"), { recursive: true });
  writeFileSync(join(home, ".config/opencode/AGENTS.md"), "## Ask the help subagent\n\nUse the `help` subagent before guessing.\n");
  mkdirSync(join(home, ".codex"), { recursive: true });
  mkdirSync(join(home, ".claude/commands"), { recursive: true });
  writeFileSync(join(home, ".claude/commands/ship.md"), "---\ndescription: ship it\n---\nShip $ARGUMENTS\n");
  return home;
}

/** Runs the CLI with an isolated HOME so agents installed on this machine never leak into a test. */
function run(args, { home } = {}) {
  const env = { ...process.env, HOME: home ?? tmp("empty-home") };
  delete env.CLAUDE_CONFIG_DIR;
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8", env });
  return { out: r.stdout + r.stderr, code: r.status };
}

const isLink = (p) => lstatSync(p).isSymbolicLink();

test("repo scope: creates AGENTS.md, .agents/skills and .goose/skills links; CLAUDE.md untouched", () => {
  const root = fixture("r1");
  run([root, "-a", "goose"]);
  assert.equal(readlinkSync(join(root, "AGENTS.md")), "CLAUDE.md");
  assert.equal(readlinkSync(join(root, ".agents/skills")), join("..", ".claude", "skills"));
  assert.equal(readlinkSync(join(root, ".goose/skills")), join("..", ".agents", "skills"));
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), "# claude rules\n");
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), "# claude rules\n");
  assert.equal(readFileSync(join(root, ".agents/skills/foo/SKILL.md"), "utf8"), "skill body\n");
  assert.equal(existsSync(join(root, "GEMINI.md")), false, "undetected agents are not wired");
});

test("repo scope is idempotent and -c passes", () => {
  const root = fixture("r2");
  run([root, "-a", "goose"]);
  const out = run([root, "-a", "goose"]).out;
  assert.match(out, /already linked/);
  const chk = run([root, "-c", "-a", "goose"]);
  assert.equal(chk.code, 0, chk.out);
  assert.match(chk.out, /all links in place/);
});

test("real AGENTS.md is merged into CLAUDE.md untagged, backup kept, then linked", () => {
  const root = fixture("r3", false);
  writeFileSync(join(root, "AGENTS.md"), "# old agents content\n");
  const res = run([root]);
  assert.match(res.out, /merge .*AGENTS\.md/);
  assert.equal(readlinkSync(join(root, "AGENTS.md")), "CLAUDE.md");
  assert.equal(readFileSync(join(root, "AGENTS.md.bak"), "utf8"), "# old agents content\n");
  const claude = readFileSync(join(root, "CLAUDE.md"), "utf8");
  assert.match(claude, /^# claude rules\n\n<!-- agent-squash: merged from AGENTS\.md on \d{4}-\d{2}-\d{2}\. Review: keep, dedupe, or re-tag\. -->\n# old agents content\n$/);
  assert.doesNotMatch(claude, /<[a-z]+>/, "shared AGENTS.md has no owner, so no tag");
  assert.doesNotMatch(claude, new RegExp(PREAMBLE_MARK), "no tags added, so no preamble");
});

test("identical AGENTS.md replaced without backup", () => {
  const root = fixture("r4", false);
  writeFileSync(join(root, "AGENTS.md"), "# claude rules\n");
  run([root]);
  assert.equal(readlinkSync(join(root, "AGENTS.md")), "CLAUDE.md");
  assert.equal(existsSync(join(root, "AGENTS.md.bak")), false);
});

test("real .goose/skills dir is never clobbered (conflict, exit 1) but --adopt moves it into .claude/skills", () => {
  const root = fixture("r5");
  mkdirSync(join(root, ".goose/skills/mine"), { recursive: true });
  writeFileSync(join(root, ".goose/skills/mine/SKILL.md"), "precious\n");
  const res = run([root, "-a", "goose"]);
  assert.notEqual(res.code, 0);
  assert.match(res.out, /left untouched — run with --adopt/);
  assert.equal(readFileSync(join(root, ".goose/skills/mine/SKILL.md"), "utf8"), "precious\n");

  const adopted = run([root, "-a", "goose", "--adopt"]);
  assert.equal(adopted.code, 0, adopted.out);
  assert.match(adopted.out, /adopt .*mine: moved/);
  assert.equal(readFileSync(join(root, ".claude/skills/mine/SKILL.md"), "utf8"), "precious\n");
  assert.equal(readlinkSync(join(root, ".goose/skills")), join("..", ".agents", "skills"));
  assert.equal(readFileSync(join(root, ".goose/skills/mine/SKILL.md"), "utf8"), "precious\n", "still reachable from goose");
});

test("--adopt removes redundant per-skill symlinks and refuses on name collision", () => {
  const root = fixture("r6");
  mkdirSync(join(root, ".agents/skills"), { recursive: true });
  symlinkSync(join("..", "..", ".claude", "skills", "foo"), join(root, ".agents/skills/foo"));
  mkdirSync(join(root, ".agents/skills/bar"));
  writeFileSync(join(root, ".agents/skills/bar/SKILL.md"), "bar\n");
  const res = run([root, "--adopt"]);
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /foo: redundant symlink/);
  assert.equal(readFileSync(join(root, ".claude/skills/bar/SKILL.md"), "utf8"), "bar\n");
  assert.equal(readlinkSync(join(root, ".agents/skills")), join("..", ".claude", "skills"));

  const dup = fixture("r6c");
  mkdirSync(join(dup, ".agents/skills/foo"), { recursive: true });
  writeFileSync(join(dup, ".agents/skills/foo/SKILL.md"), "skill body\n");
  const same = run([dup, "--adopt"]);
  assert.equal(same.code, 0, same.out);
  assert.match(same.out, /foo: identical copy/);
  assert.equal(readlinkSync(join(dup, ".agents/skills")), join("..", ".claude", "skills"));
  assert.equal(readFileSync(join(dup, ".claude/skills/foo/SKILL.md"), "utf8"), "skill body\n");

  const clash = fixture("r6b");
  mkdirSync(join(clash, ".agents/skills/foo"), { recursive: true });
  writeFileSync(join(clash, ".agents/skills/foo/SKILL.md"), "other foo\n");
  const bad = run([clash, "--adopt"]);
  assert.notEqual(bad.code, 0);
  assert.match(bad.out, /cannot adopt — already in .*: foo/);
  assert.equal(readFileSync(join(clash, ".agents/skills/foo/SKILL.md"), "utf8"), "other foo\n", "nothing moved");
  assert.equal(readFileSync(join(clash, ".claude/skills/foo/SKILL.md"), "utf8"), "skill body\n", "nothing overwritten");
});

test("dry-run changes nothing, including a pending merge", () => {
  const root = fixture("r7");
  writeFileSync(join(root, "AGENTS.md"), "# other\n");
  const res = run([root, "-n", "-a", "goose"]);
  assert.match(res.out, /would make/);
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), "# claude rules\n");
  assert.equal(isLink(join(root, "AGENTS.md")), false);
  assert.equal(existsSync(join(root, "AGENTS.md.bak")), false);
  assert.equal(existsSync(join(root, ".agents")), false);
});

test("gemini: GEMINI.md links to CLAUDE.md; a real one is merged under <gemini> with the preamble", () => {
  const root = fixture("r8");
  writeFileSync(join(root, "GEMINI.md"), "Use gemini-specific tool X.\n");
  run([root, "-a", "gemini"]);
  assert.equal(readlinkSync(join(root, "GEMINI.md")), "CLAUDE.md");
  assert.equal(existsSync(join(root, ".gemini/skills")), false, "Gemini reads .agents/skills natively — no link");
  const claude = readFileSync(join(root, "CLAUDE.md"), "utf8");
  assert.ok(claude.startsWith("> Sections wrapped in an agent tag"), "preamble inserted at top");
  assert.match(claude, /\n<gemini>\nUse gemini-specific tool X\.\n<\/gemini>\n$/);
  assert.equal(run([root, "-c", "-a", "gemini"]).code, 0);
});

test("global scope: per-agent global files link to ~/.claude/CLAUDE.md, OpenCode rules merged under <opencode>", () => {
  const home = homeFixture();
  const res = run(["-g"], { home });
  assert.equal(res.code, 0, res.out);
  assert.equal(readlinkSync(join(home, ".config/opencode/AGENTS.md")), join("..", "..", ".claude", "CLAUDE.md"));
  assert.equal(readlinkSync(join(home, ".codex/AGENTS.md")), join("..", ".claude", "CLAUDE.md"));
  assert.equal(readlinkSync(join(home, ".agents/skills")), join("..", ".claude", "skills"));
  assert.equal(existsSync(join(home, ".gemini")), false, "undetected agents are not wired");
  const claude = readFileSync(join(home, ".claude/CLAUDE.md"), "utf8");
  assert.match(claude, new RegExp(PREAMBLE_MARK));
  assert.match(claude, /<opencode>\n## Ask the help subagent\n\nUse the `help` subagent before guessing\.\n<\/opencode>\n$/);
  assert.equal(readFileSync(join(home, ".config/opencode/AGENTS.md.bak"), "utf8"), "## Ask the help subagent\n\nUse the `help` subagent before guessing.\n");
  assert.equal(readFileSync(join(home, ".codex/AGENTS.md"), "utf8"), claude, "codex sees the same file");
  assert.equal(readlinkSync(join(home, ".config/opencode/commands")), join("..", "..", ".claude", "commands"));
  assert.equal(readlinkSync(join(home, ".codex/prompts")), join("..", ".claude", "commands"));
  assert.equal(readFileSync(join(home, ".codex/prompts/ship.md"), "utf8"), "---\ndescription: ship it\n---\nShip $ARGUMENTS\n");
  const chk = run(["-g", "-c"], { home });
  assert.equal(chk.code, 0, chk.out);
});

test("-c lints agent tags: unclosed, unknown, or missing preamble fail; valid passes; oversize warns", () => {
  const root = fixture("l1", false);
  run([root]);
  const claudeMd = join(root, "CLAUDE.md");
  const ok = "> tags apply only to that agent.\n\n# rules\n\n<opencode>\nx\n</opencode>\n";

  writeFileSync(claudeMd, ok);
  assert.equal(run([root, "-c"]).code, 0);

  writeFileSync(claudeMd, "> tags apply only to that agent.\n<opencode>\nx\n");
  let r = run([root, "-c"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /<opencode> is never closed/);

  writeFileSync(claudeMd, "> tags apply only to that agent.\n<chatgpt>\nx\n</chatgpt>\n");
  r = run([root, "-c"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /unknown agent tag <chatgpt>/);

  writeFileSync(claudeMd, "<opencode>\nx\n</opencode>\n");
  r = run([root, "-c"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /no preamble/);

  writeFileSync(claudeMd, "> tags apply only to that agent.\n<opencode>\n<codex>\nx\n</codex>\n</opencode>\n");
  r = run([root, "-c"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /tags cannot nest/);

  writeFileSync(claudeMd, "# big\n" + "x".repeat(33 * 1024));
  r = run([root, "-c"]);
  assert.equal(r.code, 0, "size is a warning, not drift");
  assert.match(r.out, /Codex stops loading/);
});

test("commands: agent command dirs link to .claude/commands; --commands-to-skills converts flat ones", () => {
  const root = fixture("c1");
  mkdirSync(join(root, ".claude/commands/git"), { recursive: true });
  writeFileSync(join(root, ".claude/commands/deploy.md"), "---\ndescription: deploy\nargument-hint: [env]\n---\nDeploy to $ARGUMENTS\n");
  writeFileSync(join(root, ".claude/commands/plain.md"), "No front matter here\n");
  writeFileSync(join(root, ".claude/commands/git/commit.md"), "nested\n");
  writeFileSync(join(root, ".claude/commands/foo.md"), "---\ndescription: clashes with skill foo\n---\nx\n");

  run([root, "-a", "opencode,cursor"]);
  assert.equal(readlinkSync(join(root, ".opencode/commands")), join("..", ".claude", "commands"));
  assert.equal(readlinkSync(join(root, ".cursor/commands")), join("..", ".claude", "commands"));
  assert.equal(readFileSync(join(root, ".opencode/commands/deploy.md"), "utf8").includes("Deploy to $ARGUMENTS"), true);
  const chk = run([root, "-c", "-a", "opencode,cursor"]);
  assert.equal(chk.code, 0, chk.out);
  assert.match(chk.out, /git: nested commands/);

  const conv = run([root, "-a", "opencode", "--commands-to-skills"]);
  assert.equal(conv.code, 1, "clash with an existing skill is a conflict");
  assert.match(conv.out, /foo\.md: skill foo already exists/);
  assert.match(conv.out, /git: nested commands are not converted/);
  assert.equal(readFileSync(join(root, ".claude/skills/deploy/SKILL.md"), "utf8"), "---\ndescription: deploy\nargument-hint: [env]\ndisable-model-invocation: true\n---\nDeploy to $ARGUMENTS\n");
  assert.equal(readFileSync(join(root, ".claude/skills/plain/SKILL.md"), "utf8"), "---\ndisable-model-invocation: true\n---\n\nNo front matter here\n");
  assert.equal(existsSync(join(root, ".claude/commands/deploy.md")), false, "converted command is moved, not copied");
  assert.equal(existsSync(join(root, ".claude/commands/foo.md")), true, "clashing command left in place");
  assert.equal(readFileSync(join(root, ".agents/skills/deploy/SKILL.md"), "utf8").includes("Deploy to"), true, "reaches skills-only agents");
});

test("-c warns on skills and commands other agents would drop", () => {
  const root = fixture("l2");
  writeFileSync(join(root, ".claude/skills/foo/SKILL.md"), "---\nname: foo\ndescription: fine\n---\nok\n");
  mkdirSync(join(root, ".claude/skills/Bad_Name"));
  writeFileSync(join(root, ".claude/skills/Bad_Name/SKILL.md"), "no front matter\n");
  mkdirSync(join(root, ".claude/skills/noname"));
  writeFileSync(join(root, ".claude/skills/noname/SKILL.md"), "---\ndescription: d\n---\n");
  mkdirSync(join(root, ".claude/skills/wrongname"));
  writeFileSync(join(root, ".claude/skills/wrongname/SKILL.md"), "---\nname: other\n---\n");
  mkdirSync(join(root, ".claude/skills/empty"));
  mkdirSync(join(root, ".claude/commands"));
  writeFileSync(join(root, ".claude/commands/alias.md"), "---\nmodel: opus\n---\nx\n");
  writeFileSync(join(root, ".claude/commands/ok.md"), "---\nmodel: openrouter/anthropic/claude-opus-5\n---\nx\n");
  run([root]);
  const r = run([root, "-c"]);
  assert.equal(r.code, 0, "portability problems are warnings, not drift");
  assert.match(r.out, /Bad_Name: name must match/);
  assert.match(r.out, /Bad_Name\/SKILL\.md: must start with --- front matter/);
  assert.match(r.out, /noname\/SKILL\.md: no name — OpenCode requires name: noname/);
  assert.match(r.out, /wrongname\/SKILL\.md: name "other" must equal/);
  assert.match(r.out, /wrongname\/SKILL\.md: no description/);
  assert.match(r.out, /empty: no SKILL\.md/);
  assert.match(r.out, /alias\.md: model "opus" is a Claude alias/);
  assert.doesNotMatch(r.out, /ok\.md/);
  assert.doesNotMatch(r.out, /foo\/SKILL\.md/);
});

test("-c hints at OpenCode's single-scan switch only when OpenCode is wired and the switch is unset", () => {
  const root = fixture("l3");
  run([root, "-a", "opencode"]);
  const withHint = run([root, "-c", "-a", "opencode"]);
  assert.equal(withHint.code, 0);
  assert.match(withHint.out, /OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1/);
  const env = { ...process.env, HOME: tmp("empty-home"), OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1" };
  delete env.CLAUDE_CONFIG_DIR;
  const silenced = spawnSync("node", [CLI, root, "-c", "-a", "opencode"], { encoding: "utf8", env });
  assert.doesNotMatch(silenced.stdout + silenced.stderr, /OPENCODE_DISABLE/);
  const other = run([root, "-c", "-a", "goose"]);
  assert.doesNotMatch(other.out, /OPENCODE_DISABLE/);
});
