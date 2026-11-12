import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./run-routine.sh", import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), "run-routine-test-"));
after(() => rmSync(scratch, { force: true, recursive: true }));

const fakeHost = `#!/bin/sh
{
  printf 'cwd=%s\\n' "$(pwd -P)"
  for argument in "$@"; do printf 'arg=%s\\n' "$argument"; done
} >"$FAKE_RECORD"
[ -z "\${FAKE_IGNORE_TERM:-}" ] || trap '' TERM
printf '%s\\n' "$$" >"$FAKE_RECORD.pids"
if [ -n "\${FAKE_SLEEP:-}" ]; then
  sleep "$FAKE_SLEEP" &
  printf '%s\\n' "$!" >>"$FAKE_RECORD.pids"
  wait "$!"
fi
echo "fake host output"
exit "\${FAKE_EXIT:-0}"
`;

const repoKey = (repo) => {
  const path = realpathSync(repo);
  const name = path.split("/").pop().replace(/[^A-Za-z0-9._-]/g, "_");
  const checksum = spawnSync("sh", ["-c", `printf '%08x' "$(printf '%s' "$1" | cksum | cut -d' ' -f1)" | cut -c1-6`, "sh", path], { encoding: "utf8" });
  return `${name}-${checksum.stdout.trim()}`;
};

let counter = 0;
const sandbox = (repoName = "app") => {
  counter += 1;
  const root = join(scratch, `case-${counter}`);
  const bin = join(root, "bin");
  const repo = join(root, "repos", repoName);
  const routines = join(root, "routines");
  mkdirSync(bin, { recursive: true });
  mkdirSync(repo, { recursive: true });
  for (const name of ["claude", "codex"]) {
    writeFileSync(join(bin, name), fakeHost, { mode: 0o755 });
  }
  const record = join(root, "record");
  const key = repoKey(repo);
  const lock = join(routines, `${key}.lock`);
  const env = (extra = {}) => {
    const base = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("VISTACK_ROUTINE_") && !key.startsWith("FAKE_")),
    );
    return { ...base, FAKE_RECORD: record, HOME: root, PATH: `${bin}:${process.env.PATH}`, VISTACK_ROUTINE_DIR: routines, ...extra };
  };
  const run = (args, extra) => spawnSync(script, args, { encoding: "utf8", env: env(extra) });
  const start = (args, extra) => {
    const child = spawn(script, args, { env: env(extra), stdio: "ignore" });
    const closed = new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
    return { child, closed };
  };
  return { bin, env, key, lock, record, repo, root, routines, run, start };
};

const recorded = (path) => {
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  return {
    args: lines.filter((line) => line.startsWith("arg=")).map((line) => line.slice(4)),
    cwd: lines.find((line) => line.startsWith("cwd="))?.slice(4),
  };
};

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitFor = async (predicate, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
};

const hostPids = (record) => readFileSync(`${record}.pids`, "utf8").split("\n").filter(Boolean).map(Number);
const runningWithSleeper = (record) => () => existsSync(`${record}.pids`) && hostPids(record).length === 2;
const logOf = (box, key, routine) => {
  const names = readdirSync(join(box.routines, key)).filter((name) => name.startsWith(`${routine}-`));
  assert.equal(names.length, 1, `one ${routine} log in ${key}`);
  assert.match(names[0], new RegExp(`^${routine}-\\d{4}-\\d{2}-\\d{2}\\.log$`));
  return readFileSync(join(box.routines, key, names[0]), "utf8");
};

const tail = "nobody answers questions: decide from the evidence at hand and follow the playbook to its report step.";
const expectedInstruction = {
  "crash-hunt": `This is a scheduled crash hunt; ${tail}`,
  maintenance: `This is a scheduled maintenance routine; ${tail}`,
};

describe("run-routine.sh arguments", () => {
  test("the script is executable and parses as POSIX sh", () => {
    assert.ok(statSync(script).mode & 0o100);
    assert.equal(spawnSync("sh", ["-n", script]).status, 0);
  });

  test("refuses a missing argument, an unknown routine, an unknown host, and a missing directory", () => {
    const box = sandbox();
    assert.equal(box.run([]).status, 64);
    assert.equal(box.run(["maintenance", box.repo]).status, 64);
    const routine = box.run(["fuzz", box.repo, "claude"]);
    assert.equal(routine.status, 64);
    assert.match(routine.stderr, /unknown routine: fuzz/);
    const host = box.run(["maintenance", box.repo, "gemini"]);
    assert.equal(host.status, 64);
    assert.match(host.stderr, /unknown host: gemini/);
    const missing = box.run(["maintenance", join(box.root, "absent"), "claude"]);
    assert.equal(missing.status, 66);
    assert.match(missing.stderr, /no such repository directory/);
    assert.equal(box.run(["maintenance", "", "claude"]).status, 66);
    assert.equal(existsSync(box.record), false);
  });

  test("refuses a watchdog limit that is not a positive number", () => {
    const box = sandbox();
    for (const value of ["abc", "-5", "0"]) {
      const result = box.run(["maintenance", box.repo, "claude"], { VISTACK_ROUTINE_MAX_MINUTES: value });
      assert.equal(result.status, 64, `limit ${value}`);
    }
    assert.equal(existsSync(box.record), false);
  });

  test("exits 127 and logs when the host CLI is not on PATH", (context) => {
    const probe = spawnSync("sh", ["-c", "PATH=/usr/bin:/bin command -v claude"]);
    if (probe.status === 0) return context.skip("a real claude sits on the base PATH");
    const box = sandbox();
    const result = box.run(["maintenance", box.repo, "claude"], { PATH: "/usr/bin:/bin" });
    assert.equal(result.status, 127);
    assert.match(logOf(box, box.key, "maintenance"), /failed: claude is not on PATH/);
    assert.equal(existsSync(box.lock), false);
  });
});

describe("run-routine.sh claude invocation", () => {
  test("passes the exact default argv and runs from the repository", () => {
    const box = sandbox();
    const result = box.run(["maintenance", box.repo, "claude"]);
    assert.equal(result.status, 0);
    const call = recorded(box.record);
    assert.deepEqual(call.args, [
      "-p",
      `/vistack:maintenance ${expectedInstruction.maintenance}`,
      "--permission-mode",
      "auto",
      "--permission-prompts",
      "none",
      "--max-budget-usd",
      "25",
      "--output-format",
      "text",
    ]);
    assert.equal(call.cwd, realpathSync(box.repo));
  });

  test("runs crash-hunt by its own name", () => {
    const box = sandbox();
    box.run(["crash-hunt", box.repo, "claude"]);
    assert.equal(recorded(box.record).args[1], `/vistack:crash-hunt ${expectedInstruction["crash-hunt"]}`);
  });

  test("honors the permission mode, budget, and model overrides", () => {
    const box = sandbox();
    const result = box.run(["crash-hunt", box.repo, "claude"], {
      VISTACK_ROUTINE_BUDGET_USD: "7.5",
      VISTACK_ROUTINE_MODEL: "opus",
      VISTACK_ROUTINE_PERMISSION_MODE: "acceptEdits",
    });
    assert.equal(result.status, 0);
    assert.deepEqual(recorded(box.record).args.slice(2), [
      "--permission-mode",
      "acceptEdits",
      "--permission-prompts",
      "none",
      "--max-budget-usd",
      "7.5",
      "--output-format",
      "text",
      "--model",
      "opus",
    ]);
  });

  test("resolves a relative repository path and enters it", () => {
    const box = sandbox();
    const result = spawnSync(script, ["maintenance", "app", "claude"], {
      cwd: join(box.root, "repos"),
      encoding: "utf8",
      env: box.env(),
    });
    assert.equal(result.status, 0);
    assert.equal(recorded(box.record).cwd, realpathSync(box.repo));
  });

  test("exits with the host's exit code and logs the output", () => {
    const box = sandbox();
    const result = box.run(["maintenance", box.repo, "claude"], { FAKE_EXIT: "3" });
    assert.equal(result.status, 3);
    const log = logOf(box, box.key, "maintenance");
    assert.match(log, /fake host output/);
    assert.match(log, /finished: maintenance exit 3/);
    assert.equal(existsSync(box.lock), false);
  });

  test("logs under the sanitized repository key and the routine's date", () => {
    const box = sandbox("my repo!");
    box.run(["maintenance", box.repo, "claude"]);
    assert.match(box.key, /^my_repo_-[0-9a-f]{6}$/);
    assert.ok(existsSync(join(box.routines, box.key)));
    assert.match(logOf(box, box.key, "maintenance"), /start: maintenance claude .*my repo!/);
  });
});

describe("run-routine.sh codex invocation", () => {
  test("passes the exact codex argv", () => {
    const box = sandbox();
    const result = box.run(["crash-hunt", box.repo, "codex"]);
    assert.equal(result.status, 0);
    assert.deepEqual(recorded(box.record).args, [
      "exec",
      "--sandbox",
      "workspace-write",
      "-C",
      realpathSync(box.repo),
      `$vistack:crash-hunt ${expectedInstruction["crash-hunt"]}`,
    ]);
    assert.equal(recorded(box.record).cwd, realpathSync(box.repo));
  });
});

describe("run-routine.sh lock", () => {
  test("a second run while the first holds the lock skips and exits 0", async () => {
    const box = sandbox();
    const first = box.start(["crash-hunt", box.repo, "claude"], { FAKE_SLEEP: "5" });
    assert.ok(await waitFor(runningWithSleeper(box.record)), "the first run reached the host");
    const lock = box.lock;
    assert.ok(existsSync(join(lock, "pid")));

    const secondRecord = join(box.root, "second-record");
    const second = box.run(["crash-hunt", box.repo, "claude"], { FAKE_RECORD: secondRecord });
    assert.equal(second.status, 0);
    assert.equal(existsSync(secondRecord), false, "the second run never reached the host");
    assert.match(logOf(box, box.key, "crash-hunt"), /skipped: crash-hunt already running/);
    assert.ok(existsSync(lock), "the skipped run left the first run's lock alone");

    assert.deepEqual(await first.closed, { code: 0, signal: null });
    assert.equal(existsSync(lock), false);
  });

  test("another routine on the same repository skips and names the holder", async () => {
    const box = sandbox();
    const first = box.start(["crash-hunt", box.repo, "claude"], { FAKE_SLEEP: "5" });
    assert.ok(await waitFor(runningWithSleeper(box.record)));
    const second = box.run(["maintenance", box.repo, "claude"], { FAKE_RECORD: join(box.root, "second-record") });
    assert.equal(second.status, 0);
    assert.match(logOf(box, box.key, "maintenance"), /skipped: maintenance already running \(repository held by crash-hunt\)/);
    first.child.kill("SIGTERM");
    await first.closed;
  });

  test("two repositories do not share a lock", async () => {
    const box = sandbox("alpha");
    const other = join(box.root, "repos", "beta");
    mkdirSync(other);
    const first = box.start(["crash-hunt", box.repo, "claude"], { FAKE_SLEEP: "5" });
    assert.ok(await waitFor(runningWithSleeper(box.record)));
    const secondRecord = join(box.root, "second-record");
    const second = box.run(["crash-hunt", other, "claude"], { FAKE_RECORD: secondRecord });
    assert.equal(second.status, 0);
    assert.ok(existsSync(secondRecord), "the second repository ran");
    first.child.kill("SIGTERM");
    await first.closed;
  });

  test("two repositories with the same basename do not share a lock or a log directory", async () => {
    const box = sandbox();
    const other = join(box.root, "elsewhere", "app");
    mkdirSync(other, { recursive: true });
    const otherKey = repoKey(other);
    assert.notEqual(otherKey, box.key);
    assert.ok(otherKey.startsWith("app-") && box.key.startsWith("app-"));
    const first = box.start(["crash-hunt", box.repo, "claude"], { FAKE_SLEEP: "5" });
    assert.ok(await waitFor(runningWithSleeper(box.record)));
    const secondRecord = join(box.root, "second-record");
    const second = box.run(["crash-hunt", other, "claude"], { FAKE_RECORD: secondRecord });
    assert.equal(second.status, 0);
    assert.ok(existsSync(secondRecord), "the second repository ran");
    assert.ok(existsSync(join(box.routines, otherKey)));
    assert.ok(existsSync(box.lock), "the first repository still holds its own lock");
    first.child.kill("SIGTERM");
    await first.closed;
  });

  test("takes a lock whose holder is dead", () => {
    const box = sandbox();
    const lock = box.lock;
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "pid"), `${spawnSync("true").pid}\n`);
    const result = box.run(["maintenance", box.repo, "claude"]);
    assert.equal(result.status, 0);
    assert.ok(existsSync(box.record), "the run reached the host");
    assert.match(logOf(box, box.key, "maintenance"), /stale lock of pid \d+ removed/);
    assert.equal(existsSync(lock), false);
  });

  test("takes a lock whose pid now belongs to an unrelated process", () => {
    const box = sandbox();
    const lock = box.lock;
    mkdirSync(lock, { recursive: true });
    const bystander = spawn("sleep", ["30"], { stdio: "ignore" });
    writeFileSync(join(lock, "pid"), `${bystander.pid}\n`);
    const result = box.run(["maintenance", box.repo, "claude"]);
    bystander.kill();
    assert.equal(result.status, 0);
    assert.ok(existsSync(box.record), "the run reached the host");
    assert.equal(existsSync(lock), false);
  });

  test("a SIGTERM to the runner stops the host and releases the lock", async () => {
    const box = sandbox();
    const first = box.start(["maintenance", box.repo, "claude"], { FAKE_SLEEP: "30" });
    assert.ok(await waitFor(runningWithSleeper(box.record)));
    const pids = hostPids(box.record);
    first.child.kill("SIGTERM");
    assert.deepEqual(await first.closed, { code: 143, signal: null });
    assert.equal(existsSync(box.lock), false);
    assert.ok(await waitFor(() => pids.every((pid) => !isAlive(pid)), 5000), "the host and its sleeper are gone");
  });
});

describe("run-routine.sh watchdog", () => {
  test("kills a sleeping host and exits 124", async () => {
    const box = sandbox();
    const started = Date.now();
    const result = box.run(["crash-hunt", box.repo, "claude"], {
      FAKE_SLEEP: "30",
      VISTACK_ROUTINE_GRACE_SECONDS: "5",
      VISTACK_ROUTINE_MAX_MINUTES: "0.02",
    });
    assert.equal(result.status, 124);
    assert.ok(Date.now() - started < 20000, "the watchdog ended the run long before the sleep did");
    assert.match(logOf(box, box.key, "crash-hunt"), /killed: crash-hunt ran past 0.02 minutes/);
    assert.equal(existsSync(box.lock), false);
    const pids = hostPids(box.record);
    assert.ok(await waitFor(() => pids.every((pid) => !isAlive(pid)), 5000), "the host and its sleeper are gone");
  });

  test("escalates to KILL when the host ignores TERM", async () => {
    const box = sandbox();
    const result = box.run(["crash-hunt", box.repo, "claude"], {
      FAKE_IGNORE_TERM: "1",
      FAKE_SLEEP: "30",
      VISTACK_ROUTINE_GRACE_SECONDS: "1",
      VISTACK_ROUTINE_MAX_MINUTES: "0.02",
    });
    assert.equal(result.status, 124);
    assert.equal(existsSync(box.lock), false);
    const pids = hostPids(box.record);
    assert.ok(await waitFor(() => pids.every((pid) => !isAlive(pid)), 5000), "the host and its sleeper are gone");
  });

  test("a run that finishes in time leaves no watchdog behind", () => {
    const box = sandbox();
    const result = box.run(["maintenance", box.repo, "claude"], { VISTACK_ROUTINE_MAX_MINUTES: "29.5" });
    assert.equal(result.status, 0);
    const leftover = spawnSync("sh", ["-c", "ps -A -o command= | grep -c 'sleep 1770$' || true"], { encoding: "utf8" });
    assert.equal(Number(leftover.stdout.trim()), 0);
  });
});
