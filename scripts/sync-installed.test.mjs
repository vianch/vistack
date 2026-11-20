import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./sync-installed.sh", import.meta.url));
const verifyScript = fileURLToPath(new URL("./verify.sh", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "sync-installed-test-"));
after(() => rmSync(scratch, { force: true, recursive: true }));

const writeTree = (root, version, files) => {
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin", "plugin.json"), `{\n  "name": "vistack",\n  "version": "${version}"\n}\n`);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), content);
  }
};

let counter = 0;
const sandbox = ({ checkout, installed }) => {
  counter += 1;
  const base = join(scratch, `case-${counter}`);
  const root = join(base, "checkout");
  const installedRoot = join(base, "installed");
  const backups = join(base, "backups");
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(script, join(root, "scripts", "sync-installed.sh"));
  writeTree(root, checkout.version, checkout.files ?? {});
  writeTree(installedRoot, installed.version, installed.files ?? {});
  mkdirSync(join(installedRoot, "scripts"), { recursive: true });
  copyFileSync(script, join(installedRoot, "scripts", "sync-installed.sh"));
  const env = { ...process.env, HOME: base, VISTACK_BACKUP_ROOT: backups, VISTACK_INSTALLED: installedRoot };
  const run = (...args) => spawnSync("bash", [join(root, "scripts", "sync-installed.sh"), ...args], { encoding: "utf8", env });
  const backupDirs = () => (existsSync(backups) ? readdirSync(backups) : []);
  const read = (name) => readFileSync(join(installedRoot, name), "utf8");
  return { backupDirs, backups, installedRoot, read, root, run };
};

const output = (result) => `${result.stdout}${result.stderr}`;

describe("sync-installed.sh refusals write nothing", () => {
  test("refuses when the installed copy is newer and names the recovery command", () => {
    const box = sandbox({
      checkout: { files: { "skills/a.md": "checkout" }, version: "0.34.1" },
      installed: { files: { "skills/a.md": "installed", "skills/only.md": "keep" }, version: "0.35.0" },
    });
    const result = box.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /REFUSED/);
    assert.match(result.stderr, /0\.35\.0, newer than this checkout at 0\.34\.1/);
    assert.match(result.stderr, /rsync -rcn --itemize-changes .*--exclude \\\*\.pyc "[^"]+\/installed\/" "[^"]+\/checkout\/"/);
    assert.equal(box.read("skills/a.md"), "installed");
    assert.equal(box.read("skills/only.md"), "keep");
    assert.deepEqual(box.backupDirs(), []);
  });

  test("compares versions numerically, not as text", () => {
    const box = sandbox({ checkout: { version: "0.9.0" }, installed: { version: "0.10.0" } });
    const result = box.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /0\.10\.0, newer than this checkout at 0\.9\.0/);
  });

  test("--check-version refuses a newer installed copy and passes an older one", () => {
    const newer = sandbox({ checkout: { version: "0.34.1" }, installed: { version: "0.35.0" } });
    assert.notEqual(newer.run("--check-version").status, 0);
    const older = sandbox({ checkout: { files: { "a.md": "x" }, version: "0.35.0" }, installed: { version: "0.34.1" } });
    const result = older.run("--check-version");
    assert.equal(result.status, 0);
    assert.equal(existsSync(join(older.installedRoot, "a.md")), false);
    assert.deepEqual(older.backupDirs(), []);
  });

  test("refuses an installed-only file without --allow-delete and lists it", () => {
    const box = sandbox({
      checkout: { files: { "skills/a.md": "new" }, version: "0.35.0" },
      installed: { files: { "skills/a.md": "old", "skills/review-pr/scripts/gh-call.mjs": "only here" }, version: "0.35.0" },
    });
    const result = box.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /skills\/review-pr\/scripts\/gh-call\.mjs/);
    assert.match(result.stderr, /--allow-delete/);
    assert.equal(box.read("skills/a.md"), "old");
    assert.equal(box.read("skills/review-pr/scripts/gh-call.mjs"), "only here");
    assert.deepEqual(box.backupDirs(), []);
  });

  test("refuses an unknown argument and a missing installed copy", () => {
    const box = sandbox({ checkout: { version: "0.35.0" }, installed: { version: "0.35.0" } });
    assert.equal(box.run("--force").status, 64);
    rmSync(box.installedRoot, { force: true, recursive: true });
    assert.equal(box.run().status, 66);
  });
});

describe("sync-installed.sh syncs", () => {
  test("--allow-delete syncs and the backup holds the deleted file", () => {
    const box = sandbox({
      checkout: { files: { "skills/a.md": "new" }, version: "0.35.0" },
      installed: { files: { "skills/a.md": "old", "skills/only.md": "installed only" }, version: "0.35.0" },
    });
    const result = box.run("--allow-delete");
    assert.equal(result.status, 0, output(result));
    assert.equal(box.read("skills/a.md"), "new");
    assert.equal(existsSync(join(box.installedRoot, "skills/only.md")), false);
    const [backup] = box.backupDirs();
    assert.match(backup, /^0\.35\.0-\d{8}T\d{6}Z/);
    assert.equal(readFileSync(join(box.backups, backup, "skills/only.md"), "utf8"), "installed only");
    assert.equal(readFileSync(join(box.backups, backup, "skills/a.md"), "utf8"), "old");
    assert.ok(result.stdout.includes(join(box.backups, backup)));
    assert.match(result.stdout, /start a new session so the hosts reload the plugin/i);
  });

  test("plain drift syncs, bumps the version, and keeps a backup", () => {
    const box = sandbox({
      checkout: { files: { "skills/a.md": "new", "skills/b.md": "added" }, version: "0.35.0" },
      installed: { files: { "skills/a.md": "old" }, version: "0.34.1" },
    });
    const result = box.run();
    assert.equal(result.status, 0, output(result));
    assert.equal(box.read("skills/a.md"), "new");
    assert.equal(box.read("skills/b.md"), "added");
    assert.match(box.read(".claude-plugin/plugin.json"), /0\.35\.0/);
    const [backup] = box.backupDirs();
    assert.match(backup, /^0\.34\.1-/);
    assert.equal(readFileSync(join(box.backups, backup, "skills/a.md"), "utf8"), "old");
    assert.match(readFileSync(join(box.backups, backup, ".claude-plugin/plugin.json"), "utf8"), /0\.34\.1/);
  });

  test("leaves excluded installed paths alone", () => {
    const box = sandbox({
      checkout: { files: { "a.md": "x" }, version: "0.35.0" },
      installed: { files: { ".claude-plugin/types/engine.d.ts": "engine", "a.md": "y", "tsconfig.json": "{}" }, version: "0.35.0" },
    });
    const result = box.run();
    assert.equal(result.status, 0, output(result));
    assert.equal(box.read(".claude-plugin/types/engine.d.ts"), "engine");
    assert.equal(box.read("tsconfig.json"), "{}");
  });

  test("equal trees are a no-op with no backup", () => {
    const files = { "skills/a.md": "same" };
    const box = sandbox({ checkout: { files, version: "0.35.0" }, installed: { files, version: "0.35.0" } });
    const result = box.run();
    assert.equal(result.status, 0, output(result));
    assert.match(result.stdout, /nothing to do/);
    assert.deepEqual(box.backupDirs(), []);
  });
});

describe("verify.sh drift step", () => {
  test("the drift message names sync-installed.sh and not a raw rsync --delete", () => {
    const text = readFileSync(verifyScript, "utf8");
    assert.match(text, /scripts\/sync-installed\.sh --check-version/);
    assert.doesNotMatch(text, /rsync -a --delete/);
  });
});
