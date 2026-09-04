import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readlinkSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

function fixture(name, withSkills = true) {
  const root = join(mkdtempSync(join(tmpdir(), "agentsync-")), name);
  mkdirSync(join(root, ".claude/skills/foo"), { recursive: true });
  writeFileSync(join(root, "CLAUDE.md"), "# claude rules\n");
  if (withSkills) writeFileSync(join(root, ".claude/skills/foo/SKILL.md"), "skill body\n");
  return root;
}

function run(args, opts = {}) {
  try {
    return { out: execFileSync("node", [CLI, ...args], { encoding: "utf8", ...opts }), code: 0 };
  } catch (e) {
    return { out: (e.stdout ?? "") + (e.stderr ?? ""), code: e.status };
  }
}

test("repo scope: creates AGENTS.md, .agents/skills and .goose/skills links; CLAUDE.md untouched", () => {
  const root = fixture("r1");
  run([root, "-a", "goose"]);
  assert.equal(readlinkSync(join(root, "AGENTS.md")), "CLAUDE.md");
  assert.equal(readlinkSync(join(root, ".agents/skills")), join("..", ".claude", "skills"));
  assert.equal(readlinkSync(join(root, ".goose/skills")), join("..", ".agents", "skills"));
  assert.equal(readFileSync(join(root, "CLAUDE.md"), "utf8"), "# claude rules\n");
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), "# claude rules\n");
  assert.equal(readFileSync(join(root, ".agents/skills/foo/SKILL.md"), "utf8"), "skill body\n");
});

test("repo scope is idempotent and -c passes", () => {
  const root = fixture("r2");
  run([root, "-a", "goose"]);
  const out = run([root, "-a", "goose"]).out;
  assert.match(out, /already linked/);
  const chk = run([root, "-c", "-a", "goose"]);
  assert.equal(chk.code, 0);
  assert.match(chk.out, /all links in place/);
});

test("real AGENTS.md is overridden by CLAUDE.md, backup kept", () => {
  const root = fixture("r3", false);
  writeFileSync(join(root, "AGENTS.md"), "# old agents content\n");
  run([root]);
  assert.equal(readlinkSync(join(root, "AGENTS.md")), "CLAUDE.md");
  assert.equal(readFileSync(join(root, "AGENTS.md.bak"), "utf8"), "# old agents content\n");
});

test("identical AGENTS.md replaced without backup", () => {
  const root = fixture("r4", false);
  writeFileSync(join(root, "AGENTS.md"), "# claude rules\n");
  run([root]);
  assert.equal(readlinkSync(join(root, "AGENTS.md")), "CLAUDE.md");
  assert.equal(existsSync(join(root, "AGENTS.md.bak")), false);
});

test("real .goose/skills dir is never clobbered (conflict, exit 1)", () => {
  const root = fixture("r5");
  mkdirSync(join(root, ".goose/skills"), { recursive: true });
  writeFileSync(join(root, ".goose/skills/mine.md"), "precious\n");
  const res = run([root, "--all"]);
  assert.notEqual(res.code, 0);
  assert.match(res.out, /left untouched/);
  assert.equal(readFileSync(join(root, ".goose/skills/mine.md"), "utf8"), "precious\n");
});

test("dry-run changes nothing", () => {
  const root = fixture("r6");
  run([root, "-n", "-a", "goose"]);
  assert.equal(existsSync(join(root, "AGENTS.md")), false);
  assert.equal(existsSync(join(root, ".agents")), false);
});

test("-c exits 1 on drift", () => {
  const root = fixture("r7");
  run([root, "-a", "goose"]);
  rmSync(join(root, ".agents/skills"));
  symlinkSync(".claude", join(root, ".agents/skills")); // wrong target
  const res = run([root, "-c", "-a", "goose"]);
  assert.equal(res.code, 1);
  assert.match(res.out, /drift detected/);
});

test("global scope links ~/.claude into ~/.agents", () => {
  const home = join(tmpdir(), "agentsync-home-" + Date.now());
  mkdirSync(join(home, ".claude/skills/foo"), { recursive: true });
  writeFileSync(join(home, "CLAUDE.md"), "# global\n");
  const res = run(["-g", "-a", "goose"], { env: { ...process.env, HOME: home } });
  assert.equal(res.code, 0, res.out);
  assert.equal(readlinkSync(join(home, "AGENTS.md")), "CLAUDE.md");
  assert.equal(readlinkSync(join(home, ".agents/skills")), join("..", ".claude", "skills"));
  assert.equal(readlinkSync(join(home, ".goose/skills")), join("..", ".agents", "skills"));
});
