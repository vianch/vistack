import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./install-aliases.mjs", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "install-aliases-test-"));
after(() => rmSync(scratch, { force: true, recursive: true }));

const validName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const write = (path, content) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const writeFixturePlugin = (root) => {
  write(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name: "vistack", version: "1.0.0" }));
  write(join(root, "skills", "qa-video", "SKILL.md"), `---\nname: qa-video\ndescription: "Record a video: Playwright, then <url> 'quoted'. Second sentence."\nargument-hint: "<scenario>"\n---\n\n# qa-video\n`);
  write(join(root, "skills", "improve", "SKILL.md"), "---\nname: improve\ndescription: Find repeated mistakes\n  and make each impossible. More text.\ndisable-model-invocation: true\n---\n");
  write(join(root, "skills", "orchestrator", "SKILL.md"), '---\nname: orchestrator\ndescription: "Alias skill."\ndisable-model-invocation: true\n---\n');
  write(join(root, "commands", "orchestrator.md"), '---\ndescription: "Alias for the entry point"\nargument-hint: "<request>"\n---\n');
  write(join(root, "skills", "run", "SKILL.md"), '---\nname: run\ndescription: "Run alias."\ndisable-model-invocation: true\n---\n');
  write(join(root, "commands", "run.md"), '---\ndescription: "Run command."\n---\n');
  write(join(root, "skills", "Bad_Name", "SKILL.md"), '---\nname: Bad_Name\ndescription: "Invalid."\n---\n');
  write(join(root, "skills", "notes", "README.md"), "no SKILL.md here\n");
};

let counter = 0;
const sandbox = () => {
  counter += 1;
  const base = join(scratch, `case-${counter}`);
  const home = join(base, "home");
  const box = { home, cwd: join(home, "work"), pluginRoot: join(base, "plugin root"), skillsDir: join(home, ".claude", "skills") };
  mkdirSync(box.cwd, { recursive: true });
  writeFixturePlugin(box.pluginRoot);
  box.alias = (name) => join(box.skillsDir, name, "SKILL.md");
  box.read = (name) => readFileSync(box.alias(name), "utf8");
  box.optionsPath = join(home, ".vistack", "aliases.json");
  return box;
};

const spawn = (box, args, { cwd = box.cwd, pluginRoot = box.pluginRoot, skillsDir = box.skillsDir } = {}) => {
  const result = spawnSync(process.execPath, [script, ...args, "--skills-dir", skillsDir, "--plugin-root", pluginRoot], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, HOME: box.home },
  });
  result.rows = new Map();
  for (const line of result.stdout.split("\n")) {
    const match = line.match(/^([a-z-]+)\t\/([a-z0-9-]+)\t(.*)$/);
    if (match) result.rows.set(match[2], { action: match[1], detail: match[3] });
  }
  return result;
};

const ok = (result) => {
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return result;
};
const action = (result, name) => result.rows.get(name)?.action;
const frontmatterValue = (content, key) => content.match(new RegExp(`^${key}: (.*)$`, "m"))?.[1];

describe("install-aliases install", () => {
  test("writes skill-mode and path-mode aliases, prefers the command, and skips the reserved name", () => {
    const box = sandbox();
    const result = ok(spawn(box, ["install"]));
    assert.deepEqual([...result.rows.keys()].sort(), ["improve", "orchestrator", "qa-video", "run"]);

    const video = box.read("qa-video");
    assert.equal(frontmatterValue(video, "name"), "qa-video");
    assert.equal(JSON.parse(frontmatterValue(video, "description")), "Alias of /vistack:qa-video. Record a video: Playwright, then <url> 'quoted'.");
    assert.equal(JSON.parse(frontmatterValue(video, "argument-hint")), "<scenario>");
    assert.match(video, /^disable-model-invocation: true$/m);
    assert.match(video, /^---\n<!-- vistack-alias target=vistack:qa-video mode=skill -->\n\n# \/qa-video\n/m);
    assert.match(video, /Skill tool with skill `vistack:qa-video`/);
    assert.match(video, /\$ARGUMENTS/);

    const improve = box.read("improve");
    assert.match(improve, /<!-- vistack-alias target=vistack:improve mode=path -->/);
    assert.equal(JSON.parse(frontmatterValue(improve, "description")), "Alias of /vistack:improve. Find repeated mistakes and make each impossible.");
    assert.ok(improve.includes(`Read \`${join(box.pluginRoot, "skills", "improve", "SKILL.md")}\` and follow it`));
    assert.ok(improve.includes(`\`\${CLAUDE_PLUGIN_ROOT}\``));
    assert.ok(improve.includes(`resolve from \`${box.pluginRoot}\``));
    assert.equal(frontmatterValue(improve, "argument-hint"), undefined);

    const orchestrator = box.read("orchestrator");
    assert.match(orchestrator, /mode=skill -->/);
    assert.equal(JSON.parse(frontmatterValue(orchestrator, "argument-hint")), "<request>");
    assert.match(frontmatterValue(orchestrator, "description"), /Alias for the entry point/);

    assert.equal(action(result, "run"), "reserved");
    assert.match(result.rows.get("run").detail, /bundled skill \/run.*rerun with --replace run to take it/);
    assert.equal(existsSync(join(box.skillsDir, "run")), false);
    assert.match(result.stdout, /3 written, 1 reserved/);
  });

  test("--replace takes a reserved name and a later plain install keeps it", () => {
    const box = sandbox();
    assert.equal(action(ok(spawn(box, ["install", "--replace", "run"])), "run"), "written");
    assert.match(box.read("run"), /mode=skill/);
    assert.equal(action(ok(spawn(box, ["install"])), "run"), "unchanged");
    assert.deepEqual(JSON.parse(readFileSync(box.optionsPath, "utf8")), { [realpathSync(box.skillsDir)]: { replace: ["run"], skip: [] } });
  });

  test("--skip persists and removes an installed alias, and --clear restores it", () => {
    const box = sandbox();
    ok(spawn(box, ["install"]));
    const skipped = ok(spawn(box, ["install", "--skip", "qa-video,run"]));
    assert.equal(action(skipped, "qa-video"), "removed");
    assert.equal(existsSync(join(box.skillsDir, "qa-video")), false);
    assert.equal(action(ok(spawn(box, ["install"])), "qa-video"), "skipped");
    assert.equal(action(ok(spawn(box, ["status"])), "qa-video"), "skipped");
    const cleared = ok(spawn(box, ["install", "--clear", "qa-video"]));
    assert.equal(action(cleared, "qa-video"), "written");
    assert.equal(action(cleared, "run"), "skipped");
  });

  test("--replace and --skip move a name out of the other list, in both directions", () => {
    const box = sandbox();
    const saved = () => JSON.parse(readFileSync(box.optionsPath, "utf8"))[realpathSync(box.skillsDir)];
    assert.equal(action(ok(spawn(box, ["install", "--skip", "run"])), "run"), "skipped");
    assert.deepEqual(saved(), { replace: [], skip: ["run"] });
    assert.equal(action(ok(spawn(box, ["install", "--replace", "run"])), "run"), "written");
    assert.deepEqual(saved(), { replace: ["run"], skip: [] });
    assert.equal(action(ok(spawn(box, ["install", "--skip", "run"])), "run"), "removed");
    assert.deepEqual(saved(), { replace: [], skip: ["run"] });
  });

  test("the walk for project skills stops before $HOME", () => {
    const box = sandbox();
    write(join(box.home, ".claude", "skills", "qa-video", "SKILL.md"), "a personal skill in the default dir\n");
    const result = ok(spawn(box, ["install"], { skillsDir: join(box.home, "custom-skills") }));
    assert.equal(action(result, "qa-video"), "written");
  });

  test("a foreign dir, a symlink, and a sibling personal command are never touched, even with --replace", () => {
    const box = sandbox();
    write(box.alias("qa-video"), "my own skill\n");
    write(join(box.home, ".claude", "commands", "improve.md"), "my own command\n");
    mkdirSync(box.skillsDir, { recursive: true });
    symlinkSync(join(box.home, "elsewhere"), join(box.skillsDir, "orchestrator"));
    const result = ok(spawn(box, ["install", "--replace", "qa-video,improve,orchestrator"]));
    for (const name of ["qa-video", "improve", "orchestrator"]) assert.equal(action(result, name), "foreign", name);
    assert.equal(box.read("qa-video"), "my own skill\n");
    assert.equal(existsSync(join(box.skillsDir, "improve")), false);
    assert.equal(existsSync(join(box.home, "elsewhere")), false);
    ok(spawn(box, ["uninstall"]));
    assert.equal(box.read("qa-video"), "my own skill\n");
    assert.equal(readFileSync(join(box.home, ".claude", "commands", "improve.md"), "utf8"), "my own command\n");
  });

  test("a project skill in a parent directory blocks the alias until --replace", () => {
    const box = sandbox();
    write(join(box.home, "project", ".claude", "skills", "qa-video", "SKILL.md"), "project skill\n");
    const cwd = join(box.home, "project", "nested");
    mkdirSync(cwd, { recursive: true });
    const result = ok(spawn(box, ["install"], { cwd }));
    assert.equal(action(result, "qa-video"), "project");
    assert.match(result.rows.get("qa-video").detail, /project.*qa-video.*rerun with --replace qa-video to take it/);
    assert.equal(action(ok(spawn(box, ["install", "--replace", "qa-video"], { cwd })), "qa-video"), "written");
  });

  test("the skills dir's own .claude is not a project collision", () => {
    const box = sandbox();
    const project = join(box.home, "project");
    const skillsDir = join(project, ".claude", "skills");
    mkdirSync(project, { recursive: true });
    ok(spawn(box, ["install"], { cwd: project, skillsDir }));
    const rerun = ok(spawn(box, ["install"], { cwd: project, skillsDir }));
    for (const name of ["improve", "orchestrator", "qa-video"]) assert.equal(action(rerun, name), "unchanged", name);
  });

  test("a rerun is idempotent: every row unchanged and the bytes identical", () => {
    const box = sandbox();
    ok(spawn(box, ["install"]));
    const before = readdirSync(box.skillsDir).map((name) => [name, box.read(name)]);
    const rerun = ok(spawn(box, ["install"]));
    for (const [name] of before) assert.equal(action(rerun, name), "unchanged", name);
    assert.deepEqual(readdirSync(box.skillsDir).map((name) => [name, box.read(name)]), before);
    const status = ok(spawn(box, ["status"]));
    for (const [name] of before) assert.equal(action(status, name), "installed", name);
  });

  test("an empty alias dir left by an interrupted write is reclaimed", () => {
    const box = sandbox();
    mkdirSync(join(box.skillsDir, "qa-video"), { recursive: true });
    assert.equal(action(ok(spawn(box, ["install"])), "qa-video"), "written");
  });

  test("an alias whose target was deleted is an orphan and the next install prunes it", () => {
    const box = sandbox();
    ok(spawn(box, ["install"]));
    rmSync(join(box.pluginRoot, "skills", "qa-video"), { recursive: true });
    assert.equal(action(ok(spawn(box, ["status"])), "qa-video"), "orphan");
    assert.equal(action(ok(spawn(box, ["install"])), "qa-video"), "removed");
    assert.equal(existsSync(join(box.skillsDir, "qa-video")), false);
  });
});

describe("install-aliases status, uninstall, and dry runs", () => {
  test("status reports stale content and a path alias whose plugin root moved", () => {
    const box = sandbox();
    ok(spawn(box, ["install"]));
    writeFileSync(box.alias("qa-video"), `${box.read("qa-video")}extra\n`);
    const moved = join(dirname(box.pluginRoot), "moved root");
    renameSync(box.pluginRoot, moved);
    const status = ok(spawn(box, ["status"], { pluginRoot: moved }));
    assert.equal(action(status, "qa-video"), "stale");
    assert.equal(action(status, "improve"), "root-missing");
    assert.equal(action(status, "orchestrator"), "installed");
  });

  test("uninstall removes only marker-owned aliases and keeps a dir holding another file", () => {
    const box = sandbox();
    ok(spawn(box, ["install", "--replace", "run"]));
    write(join(box.skillsDir, "improve", "notes.txt"), "keep\n");
    write(box.alias("mine"), "---\nname: mine\n---\n<!-- vistack-alias target=vistack:other mode=skill -->\n");
    const result = ok(spawn(box, ["uninstall"]));
    assert.equal(action(result, "qa-video"), "removed");
    assert.equal(action(result, "improve"), "kept-dir");
    assert.equal(result.rows.has("mine"), false);
    assert.deepEqual(readdirSync(box.skillsDir).sort(), ["improve", "mine"]);
    assert.deepEqual(readdirSync(join(box.skillsDir, "improve")), ["notes.txt"]);
    assert.ok(existsSync(box.optionsPath));
  });

  test("--dry-run writes no alias, no options file, and deletes nothing", () => {
    const box = sandbox();
    const dry = ok(spawn(box, ["install", "--dry-run", "--replace", "run"]));
    assert.equal(action(dry, "run"), "written");
    assert.match(dry.stdout, /dry run/);
    assert.equal(existsSync(box.skillsDir), false);
    assert.equal(existsSync(box.optionsPath), false);
    ok(spawn(box, ["install"]));
    assert.equal(action(ok(spawn(box, ["uninstall", "--dry-run"])), "qa-video"), "removed");
    assert.ok(existsSync(box.alias("qa-video")));
  });

  test("an unknown flag, an unknown subcommand, or an invalid name is a usage error", () => {
    const box = sandbox();
    for (const args of [["install", "--force"], ["reinstall"], ["install", "--skip", "Bad_Name"], ["install", "--replace"]]) {
      const result = spawn(box, args);
      assert.equal(result.status, 2, args.join(" "));
      assert.match(result.stderr, /usage: /);
    }
  });
});

describe("install-aliases ownership, project blocks, and options", () => {
  const quoting = (name) => `---\nname: ${name}\ndescription: "my notes"\n---\n\n# Notes\n\n\`\`\`\n<!-- vistack-alias target=vistack:${name} mode=skill -->\n\`\`\`\n`;

  test("a user skill quoting the marker in its body survives install, --skip, --replace, uninstall, and orphan prune", () => {
    const box = sandbox();
    for (const name of ["qa-video", "improve", "my-notes"]) write(box.alias(name), quoting(name));
    const install = ok(spawn(box, ["install"]));
    assert.equal(action(install, "qa-video"), "foreign");
    assert.equal(action(install, "improve"), "foreign");
    assert.equal(install.rows.has("my-notes"), false);
    ok(spawn(box, ["install", "--skip", "improve", "--replace", "qa-video"]));
    assert.equal(ok(spawn(box, ["status"])).rows.has("my-notes"), false);
    ok(spawn(box, ["uninstall"]));
    for (const name of ["qa-video", "improve", "my-notes"]) assert.equal(box.read(name), quoting(name), name);
  });

  test("a SKILL.md that is a symlink stays foreign and is never written or deleted through", () => {
    const box = sandbox();
    ok(spawn(box, ["install"]));
    const outside = join(box.home, "outside.md");
    writeFileSync(outside, `${box.read("qa-video")}edited\n`);
    rmSync(box.alias("qa-video"));
    symlinkSync(outside, box.alias("qa-video"));
    assert.equal(action(ok(spawn(box, ["install"])), "qa-video"), "foreign");
    ok(spawn(box, ["uninstall"]));
    assert.ok(lstatSync(box.alias("qa-video")).isSymbolicLink());
    assert.match(readFileSync(outside, "utf8"), /edited\n$/);
  });

  test("a project skill reports its row and leaves an installed alias in place", () => {
    const box = sandbox();
    ok(spawn(box, ["install"]));
    const before = box.read("qa-video");
    const cwd = join(box.home, "project");
    write(join(cwd, ".claude", "skills", "qa-video", "SKILL.md"), "project skill\n");
    const install = ok(spawn(box, ["install"], { cwd }));
    assert.equal(action(install, "qa-video"), "project");
    assert.match(install.rows.get("qa-video").detail, /installed alias stays/);
    assert.equal(box.read("qa-video"), before);
    assert.equal(action(ok(spawn(box, ["status"], { cwd })), "qa-video"), "project");
    assert.equal(action(ok(spawn(box, ["install", "--skip", "qa-video"], { cwd })), "qa-video"), "removed");
  });

  test("install rewrites a stale owned alias", () => {
    const box = sandbox();
    ok(spawn(box, ["install"]));
    const original = box.read("qa-video");
    writeFileSync(box.alias("qa-video"), `${original}extra\n`);
    assert.equal(action(ok(spawn(box, ["status"])), "qa-video"), "stale");
    assert.equal(action(ok(spawn(box, ["install"])), "qa-video"), "written");
    assert.equal(box.read("qa-video"), original);
  });

  test("a corrupt options file exits 1 and is left as it was", () => {
    const box = sandbox();
    write(box.optionsPath, "{not json");
    const result = spawn(box, ["install", "--skip", "qa-video"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /fix or delete it/);
    assert.equal(readFileSync(box.optionsPath, "utf8"), "{not json");
    assert.equal(existsSync(box.skillsDir), false);
  });

  test("options are keyed by the real skills dir, so a symlinked path shares them", () => {
    const box = sandbox();
    mkdirSync(box.skillsDir, { recursive: true });
    const linked = join(box.home, "linked-skills");
    symlinkSync(box.skillsDir, linked);
    ok(spawn(box, ["install", "--skip", "qa-video"], { skillsDir: linked }));
    assert.equal(action(ok(spawn(box, ["install"])), "qa-video"), "skipped");
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(box.optionsPath, "utf8"))), [realpathSync(box.skillsDir)]);
  });

  test("an option naming no skill or command warns on stderr and still exits 0", () => {
    const box = sandbox();
    const result = ok(spawn(box, ["install", "--skip", "nope", "--replace", "qa-video"]));
    assert.match(result.stderr, /warning: --skip nope: no vistack skill or command/);
    assert.doesNotMatch(result.stderr, /qa-video/);
  });
});

describe("install-aliases against this repository", () => {
  test("every generated alias has a valid name, a parseable one-line description, the flag, and the marker", () => {
    const box = sandbox();
    const result = ok(spawn(box, ["install"], { pluginRoot: repositoryRoot }));
    assert.equal(action(result, "run"), "reserved");
    assert.equal(action(result, "advisor"), "reserved");
    const names = readdirSync(box.skillsDir);
    assert.ok(names.length > 40, `${names.length} aliases`);
    for (const name of names) {
      const content = box.read(name);
      const header = content.slice(4, content.indexOf("\n---\n", 4)).split("\n");
      for (const line of header) assert.match(line, /^[a-z-]+: \S/, `${name}: ${line}`);
      assert.equal(frontmatterValue(content, "name"), name);
      assert.match(name, validName);
      const description = JSON.parse(frontmatterValue(content, "description"));
      assert.ok(description.startsWith(`Alias of /vistack:${name}.`) && description.length <= 160, description);
      assert.match(content, /^disable-model-invocation: true$/m);
      assert.match(content, new RegExp(`^<!-- vistack-alias target=vistack:${name} mode=(skill|path) -->$`, "m"));
    }
    assert.match(box.read("improve"), /mode=path/);
    assert.match(box.read("qa-video"), /mode=skill/);
  });
});
