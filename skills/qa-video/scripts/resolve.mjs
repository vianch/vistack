import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { compareVersions, errorText, firstLine } from "./media.mjs";

export const playwrightInstall = "npm i -D playwright && npx playwright install chromium";
export const installHint = `${playwrightInstall} (or pass --playwright <path>, or set QA_VIDEO_PLAYWRIGHT)`;

const playwrightIds = ["playwright", "@playwright/test", "playwright-core"];
const dependencyFields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
const ffmpegBinaries = { darwin: "ffmpeg-mac", linux: "ffmpeg-linux", win32: "ffmpeg-win64.exe" };
const revisionDirectory = /^[a-z][a-z0-9_]*-\d+$/;

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};

const isDirectory = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const ancestors = (start) => {
  const chain = [resolve(start)];
  while (dirname(chain.at(-1)) !== chain.at(-1)) chain.push(dirname(chain.at(-1)));
  return chain;
};

const declaredIds = (directory) => {
  const manifest = readJson(join(directory, "package.json"));
  return playwrightIds.filter((id) => dependencyFields.some((field) => manifest?.[field]?.[id]));
};

const packageIn = (modulesDir, ids) => ids.find((id) => existsSync(join(modulesDir, id, "package.json"))) ?? null;

const packageDirOf = (file) => {
  for (let directory = dirname(file); directory !== dirname(directory); directory = dirname(directory)) {
    if (existsSync(join(directory, "package.json"))) return directory;
  }
  return null;
};

export const globalModuleDirs = (env, { platform = process.platform, execPath = process.execPath, home = homedir() } = {}) => {
  if (env.QA_VIDEO_GLOBAL_MODULES !== undefined) return env.QA_VIDEO_GLOBAL_MODULES.split(delimiter).filter(Boolean);
  const windows = platform === "win32";
  const prefixes = [env.npm_config_prefix, windows ? dirname(execPath) : dirname(dirname(execPath)), join(home, ".npm-global"), ...(windows ? [env.APPDATA && join(env.APPDATA, "npm")] : ["/opt/homebrew", "/usr/local", "/usr"])];
  const libraries = prefixes.filter(Boolean).map((prefix) => (windows ? join(prefix, "node_modules") : join(prefix, "lib", "node_modules")));
  const userFolders = [join(home, ".node_modules"), join(home, ".node_libraries"), join(home, ".config", "yarn", "global", "node_modules"), join(home, ".bun", "install", "global", "node_modules")];
  return [...new Set([...libraries, ...userFolders])];
};

const explicitEntry = (from, value, tried) => {
  const target = resolve(value);
  try {
    const entry = createRequire(import.meta.url).resolve(target);
    tried.push({ from, path: target, outcome: "found" });
    return { from, entry };
  } catch (error) {
    tried.push({ from, path: target, outcome: `cannot resolve: ${firstLine(errorText(error))}` });
    return null;
  }
};

const found = (tried, from, modulesDir, id, note = "") => {
  tried.push({ from, path: modulesDir, outcome: `found ${id}${note}` });
  return { from, packageDir: join(modulesDir, id) };
};

const declaredEntry = (chain, projectRoot, cwd, tried) => {
  const declared = declaredIds(projectRoot);
  const manifest = join(projectRoot, "package.json");
  const start = chain.indexOf(projectRoot);
  for (const directory of chain.slice(0, start)) {
    const id = packageIn(join(directory, "node_modules"), playwrightIds);
    if (id) tried.push({ from: "cwd", path: join(directory, "node_modules"), outcome: `skipped ${id}: ${manifest} declares ${declared.join(", ")}` });
  }
  for (const directory of chain.slice(start)) {
    const modulesDir = join(directory, "node_modules");
    const id = packageIn(modulesDir, declared);
    if (id) return found(tried, "project-root", modulesDir, id, `, declared by ${manifest}`);
  }
  tried.push({ from: "project-root", path: manifest, outcome: `declares ${declared.join(", ")}, but no node_modules at or above ${projectRoot} holds it` });
  return { reason: `not found from ${cwd}: ${manifest} declares ${declared.join(", ")}, but it is not installed; install the project's dependencies` };
};

const discoveredEntry = (cwd, env, tried) => {
  const chain = ancestors(cwd);
  const home = resolve(homedir());
  const repoRoot = chain.find((directory) => directory !== home && (isDirectory(join(directory, ".claude")) || isDirectory(join(directory, ".codex")))) ?? null;
  const projectRoot = chain.find((directory) => declaredIds(directory).length > 0) ?? null;
  if (projectRoot) return declaredEntry(chain, projectRoot, cwd, tried);
  for (const directory of chain) {
    const from = directory === repoRoot ? "repo-root" : "cwd";
    const modulesDir = join(directory, "node_modules");
    const hasModules = isDirectory(modulesDir);
    if (from === "cwd" && !hasModules) continue;
    const id = packageIn(modulesDir, playwrightIds);
    if (id) return found(tried, from, modulesDir, id);
    tried.push({ from, path: modulesDir, outcome: hasModules ? "no Playwright package" : "no node_modules" });
  }
  if (!tried.some((candidate) => candidate.from === "cwd")) tried.unshift({ from: "cwd", path: resolve(cwd), outcome: "no node_modules here or in any parent" });
  if (!repoRoot) tried.push({ from: "repo-root", path: null, outcome: `no parent of ${cwd} holds .claude or .codex` });
  tried.push({ from: "project-root", path: null, outcome: `no package.json at or above ${cwd} declares ${playwrightIds.join(", ")}` });
  const nodePath = (env.NODE_PATH ?? "").split(delimiter).filter(Boolean);
  if (nodePath.length === 0) tried.push({ from: "node-path", path: null, outcome: "NODE_PATH is empty" });
  for (const [from, directories] of [["node-path", nodePath], ["global", globalModuleDirs(env)]]) {
    for (const modulesDir of directories) {
      const id = packageIn(modulesDir, playwrightIds);
      if (id) return found(tried, from, modulesDir, id);
      tried.push({ from, path: modulesDir, outcome: isDirectory(modulesDir) ? "no Playwright package" : "absent" });
    }
  }
  return { reason: `not found from ${cwd}` };
};

export const resolvePlaywright = async (flag, { env, cwd = process.cwd() }) => {
  const explicit = flag ? ["flag", flag] : env.QA_VIDEO_PLAYWRIGHT ? ["env", env.QA_VIDEO_PLAYWRIGHT] : null;
  const result = { found: false, path: null, version: null, source: explicit?.[0] ?? "cwd", screencast: false, api: null, reason: null, resolvedFrom: null, candidatesTried: [] };
  const located = explicit ? explicitEntry(...explicit, result.candidatesTried) ?? { reason: `cannot resolve ${resolve(explicit[1])}` } : discoveredEntry(cwd, env, result.candidatesTried);
  if (!located.from) return { ...result, reason: located.reason };
  result.resolvedFrom = located.from;
  let entry = located.entry;
  try {
    entry ??= createRequire(import.meta.url).resolve(located.packageDir);
    result.path = packageDirOf(entry);
    result.version = readJson(join(result.path, "package.json"))?.version ?? null;
    const module = await import(pathToFileURL(entry).href);
    result.api = module.chromium ? module : module.default;
  } catch (error) {
    return { ...result, reason: `cannot load ${entry ?? located.packageDir}: ${errorText(error)}` };
  }
  if (!result.api?.chromium) return { ...result, api: null, reason: `${entry} exports no browser types` };
  return { ...result, found: true, screencast: compareVersions(result.version, "1.59.0") >= 0 };
};

const browsersJsonFor = (packageDir, depth = 0) => {
  const directory = realpathSync(packageDir);
  if (existsSync(join(directory, "browsers.json"))) return { coreDir: directory, path: join(directory, "browsers.json") };
  const dependencies = readJson(join(directory, "package.json"))?.dependencies ?? {};
  for (const id of depth < 2 ? ["playwright-core", "playwright"].filter((name) => dependencies[name]) : []) {
    try {
      const found = browsersJsonFor(dirname(createRequire(join(directory, "package.json")).resolve(`${id}/package.json`)), depth + 1);
      if (found) return found;
    } catch {}
  }
  return null;
};

const cacheFromExecutable = (executable) => {
  for (let directory = executable ? dirname(executable) : null; directory && directory !== dirname(directory); directory = dirname(directory)) {
    if (revisionDirectory.test(basename(directory))) return dirname(directory);
  }
  return null;
};

export const browsersCacheRoot = ({ env, coreDir, executable = null, platform = process.platform, home = homedir(), cwd = process.cwd() }) => {
  const fromExecutable = cacheFromExecutable(executable);
  if (fromExecutable) return { cache: fromExecutable, from: "executablePath", reason: null };
  const value = env.PLAYWRIGHT_BROWSERS_PATH;
  if (value === "0") {
    return coreDir ? { cache: join(coreDir, ".local-browsers"), from: "PLAYWRIGHT_BROWSERS_PATH=0", reason: null }
      : { cache: null, from: "PLAYWRIGHT_BROWSERS_PATH=0", reason: "PLAYWRIGHT_BROWSERS_PATH=0 keeps browsers inside playwright-core, which was not found" };
  }
  if (value) return { cache: isAbsolute(value) ? value : resolve(env.INIT_CWD || cwd, value), from: "PLAYWRIGHT_BROWSERS_PATH", reason: null };
  const base = platform === "darwin" ? join(home, "Library", "Caches")
    : platform === "win32" ? env.LOCALAPPDATA || join(home, "AppData", "Local") : env.XDG_CACHE_HOME || join(home, ".cache");
  return { cache: join(base, "ms-playwright"), from: "default", reason: null };
};

const installedRevisions = (cache, name) => {
  const pattern = new RegExp(`^${name.replace(/-/g, "_")}(_.+_special)?-(\\d+)$`);
  let entries = [];
  try {
    entries = cache ? readdirSync(cache) : [];
  } catch {
    return [];
  }
  return entries.map((entry) => ({ entry, match: entry.match(pattern) }))
    .filter(({ entry, match }) => match && existsSync(join(cache, entry, "INSTALLATION_COMPLETE")))
    .map(({ entry, match }) => ({ dir: join(cache, entry), revision: match[2], special: Boolean(match[1]) }));
};

const revisionStatus = (cache, browsersJson, name) => {
  const entry = browsersJson?.browsers?.find((item) => item.name === name);
  if (!entry) return null;
  const overrides = Object.values(entry.revisionOverrides ?? {});
  const match = installedRevisions(cache, name).find((item) => (item.special ? overrides.includes(item.revision) : item.revision === entry.revision));
  return { expected: entry.revision, present: Boolean(match), dir: match?.dir ?? null, missing: match ? [] : [`${name.replace(/-/g, "_")}-${entry.revision}`] };
};

export const bundledFfmpeg = (cache, browsersJson, platform = process.platform) => {
  const binary = ffmpegBinaries[platform] ?? ffmpegBinaries.linux;
  const status = revisionStatus(cache, browsersJson, "ffmpeg");
  if (status) return { expected: status.expected, present: status.present, path: status.dir && join(status.dir, binary), missing: status.missing, note: null };
  const newest = installedRevisions(cache, "ffmpeg").sort((left, right) => Number(right.revision) - Number(left.revision))[0];
  const note = `browsers.json unavailable; ${newest ? `picked the newest present ${basename(newest.dir)}` : "no ffmpeg-* in the cache"}`;
  return { expected: null, present: Boolean(newest), path: newest ? join(newest.dir, binary) : null, missing: [], note };
};

export const browsersReport = ({ playwright, browser, executable, env, cwd = process.cwd() }) => {
  const manifest = playwright.path ? browsersJsonFor(playwright.path) : null;
  const browsersJson = manifest ? readJson(manifest.path) : null;
  const root = browsersCacheRoot({ env, coreDir: manifest?.coreDir, executable, cwd });
  const needed = [browser, ...(browser === "chromium" ? ["chromium-headless-shell"] : [])].map((name) => revisionStatus(root.cache, browsersJson, name)).filter(Boolean);
  const reason = root.reason ?? (browsersJson ? null : manifest ? `cannot read ${manifest.path}` : playwright.found ? `no browsers.json under ${playwright.path}` : "Playwright not found, so the expected revisions are unknown");
  return {
    cache: root.cache,
    cacheFrom: root.from,
    manifest: manifest?.path ?? null,
    [browser]: needed.length ? { expected: needed[0].expected, present: needed.every((status) => status.present), missing: needed.flatMap((status) => status.missing) } : { expected: null, present: null, missing: [] },
    ffmpeg: bundledFfmpeg(root.cache, browsersJson),
    reason,
  };
};
