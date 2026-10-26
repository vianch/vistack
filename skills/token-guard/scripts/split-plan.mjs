// split-plan builds the plan token-guard prints for a file over the limit: names, counts, and
// target paths read from the text. token-guard.mjs imports it by a relative path, and `install`
// copies both files beside the hook, so this file imports only Node too.

import { basename, extname } from "node:path";

export const commas = (value) => value.toLocaleString("en-US");
const size = (text) => Math.ceil(Buffer.byteLength(text) / 4);
const kinds = { ".ts": "TypeScript", ".tsx": "TypeScript/React", ".js": "JavaScript", ".jsx": "JavaScript/React", ".mjs": "JavaScript", ".cjs": "JavaScript", ".py": "Python", ".md": "Markdown", ".json": "JSON", ".yml": "YAML", ".yaml": "YAML" };

const listNames = (items) => items.slice(0, 6).join(", ") + (items.length > 6 ? `, and ${items.length - 6} more` : "");
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "part";
const area = (path) => basename(path).replace(/\..*$/, "").replace(/[^A-Za-z0-9]+(.)?/g, (_, next = "") => next.toUpperCase()).replace(/^./, (first) => first.toLowerCase());
const lineCount = (text) => text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
const names = (text, pattern) => [...text.matchAll(pattern)].map((match) => match[1] ?? match[2]);
const keyed = (key) => ({ name: JSON.stringify(key), key });
const generic = (path, text) => [`${commas(lineCount(text))} lines; split by responsibility into two files next to ${basename(path)}, each named for what it holds`];
const testName = (path) => basename(path).match(/^(.*?)\.(test|spec)\./);
const keys = {
  label: "top-level keys",
  advice: ({ stem, extension, top }) => `one file per top-level key next to this one, e.g. ${stem}.${slug(top.key)}${extension} for ${top.name}`,
  extra: ({ path }) => [`a data file rather than authored config is exempt once marked: echo '${path} token-guard=ignore' >> .gitattributes`],
};

// Kinds read as sections: `find` is a pattern and a maker, or a function; plan = label, advice, extra.
const sectionKinds = {
  tests: {
    label: "describe blocks",
    find: [/^describe(?:\.\w+)?\(\s*(["'`])((?:\\.|(?!\1).)*)\1/gm, (match) => keyed(match[2])],
    advice: ({ path, extension, top }) => `one file per describe next to this one, e.g. ${testName(path)[1]}.${slug(top.key)}.${testName(path)[2]}${extension} for ${top.name}`,
  },
  Python: {
    label: "top-level definitions",
    find: [/^(?:async\s+)?(def|class)\s+(\w+)/gm, (match) => ({ name: `${match[1]} ${match[2]}` })],
    advice: ({ stem }) => `turn ${stem}.py into a package ${stem}/ with one module per class or group of functions, and ${stem}/__init__.py re-exporting what callers import`,
  },
  Markdown: {
    label: "H2 sections",
    find: (text) => {
      const found = [];
      let [fence, offset] = [null, 0];
      for (const line of text.split("\n")) {
        const opener = line.match(/^\s*(`{3,}|~{3,})/)?.[1][0];
        if (opener && (!fence || opener === fence)) fence = fence ? null : opener;
        else if (!fence && /^## (?!#)/.test(line)) found.push({ index: offset, name: JSON.stringify(line.trim()), key: line.slice(3).trim() });
        offset += line.length + 1;
      }
      return found;
    },
    advice: ({ top }) => `move the largest sections to references/<section>.md next to the file, starting with ${top.name} as references/${slug(top.key)}.md, and link each from a one-line pointer`,
    extra: ({ path, text }) => (basename(path) === "SKILL.md" ? [`SKILL.md should stay under 500 lines (this one has ${commas(lineCount(text))}); detail goes to references/ next to it`] : []),
  },
  JSON: {
    ...keys,
    find: (text) => {
      try {
        const parsed = JSON.parse(text);
        return parsed?.constructor === Object ? Object.entries(parsed).map(([key, value]) => ({ ...keyed(key), tokens: size(JSON.stringify(value, null, 2)) })) : [];
      } catch {
        return [];
      }
    },
  },
  YAML: { ...keys, find: [/^(?![\s#-])("[^"]+"|'[^']+'|[^:\n]+):(?=\s|$)/gm, (match) => keyed(match[1].replace(/^["']|["']$/g, ""))] },
};

const sectioned = (path, text, kind) => {
  const found = Array.isArray(kind.find) ? [...text.matchAll(kind.find[0])].map((match) => ({ index: match.index, ...kind.find[1](match) })) : kind.find(text);
  if (!found.length) return generic(path, text);
  const sorted = found.map((start, index) => ({ ...start, tokens: start.tokens ?? size(text.slice(start.index, found[index + 1]?.index)) })).sort((left, right) => right.tokens - left.tokens);
  const extension = extname(path);
  const context = { path, text, extension, stem: basename(path, extension), top: sorted[0] };
  return [`${kind.label} (${sorted.length}) by size: ${listNames(sorted.map((section) => `${section.name} ${commas(section.tokens)} tokens`))}`, kind.advice(context), ...(kind.extra?.(context) ?? [])];
};

const scriptPlan = (path, text) => {
  const extension = extname(path);
  const target = (folder, suffix) => (/^\.tsx?$/.test(extension) ? `${folder}/${area(path)}.${suffix}.ts` : `${basename(path, extension)}.${suffix}${extension} next to this one`);
  const types = names(text, /^(?:(?:export|declare)\s+)*(?:type|interface)\s+([\w$]+)/gm);
  const constants = names(text, /^(?:export\s+)?const\s+([A-Z]\w*)\s*(?::[^=\n]+)?=\s*(?:["'`\d[{-]|true\b|false\b|null\b|new (?:Set|Map)\b|Object\.freeze\b)/gm);
  const exported = names(text, /^export\s+(?:(?:default|declare|async|abstract)\s+)*(?:function\*?|class|const|let|var|enum|namespace)\s+([\w$]+)/gm)
    .filter((found) => !constants.includes(found));
  const helpers = names(text, /^(?:(?:async\s+)?function\*?\s+([\w$]+)|(?:const|let)\s+([\w$]+)\s*(?::[^=\n]+)?=\s*(?:async\s+)?(?:function\b|(?:\([^)]*\)|[\w$]+)\s*(?::[^=]+?)?=>))/gm);
  const keep = /^\.[jt]sx$/.test(extension) && exported.some((found) => /^[A-Z]/.test(found)) ? "Keep one component per file" : "Keep the export callers use most here";
  const plan = [
    exported.length > 1 && `exported declarations (${exported.length}): ${listNames(exported)}. ${keep}; move each other export to its own file next to this one`,
    types.length && `types and interfaces (${types.length}) go to types/${area(path)}.d.ts: ${listNames(types)}`,
    helpers.length && `non-exported helpers (${helpers.length}) go to ${target("lib/utils", "utils")}: ${listNames(helpers)}`,
    constants.length && `constants (${constants.length}) go to ${target("lib/constants", "constants")}: ${listNames(constants)}`,
  ].filter(Boolean);
  return plan.length ? [...plan, `${path} stays as the file that imports and composes the pieces`] : generic(path, text);
};

export const analyze = (path, content) => {
  const text = String(content);
  let kind = kinds[extname(path).toLowerCase()] ?? "Other";
  const script = kind.includes("Script");
  if (script && testName(path)) kind = `${kind.split("/")[0]} tests`;
  const sections = sectionKinds[kind.endsWith(" tests") ? "tests" : kind];
  return { kind, suggestions: sections ? sectioned(path, text, sections) : script ? scriptPlan(path, text) : generic(path, text) };
};
