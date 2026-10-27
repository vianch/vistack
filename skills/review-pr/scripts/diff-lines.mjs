const unquotePath = (text) => {
  if (!text.startsWith('"') || !text.endsWith('"')) return text;
  const escapes = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '"': 34, "\\": 92 };
  const bytes = [];
  for (let index = 1; index < text.length - 1; index += 1) {
    const character = text[index];
    if (character !== "\\") {
      bytes.push(...Buffer.from(character, "utf8"));
      continue;
    }
    const octal = text.slice(index + 1, index + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(parseInt(octal, 8));
      index += 3;
    } else {
      const next = text[index + 1];
      bytes.push(escapes[next] ?? next.charCodeAt(0));
      index += 1;
    }
  }
  return Buffer.from(bytes).toString("utf8");
};

const newSidePath = (header) => {
  const raw = header.slice(4).replace(/\t$/, "");
  if (raw === "/dev/null") return null;
  const path = unquotePath(raw);
  return path.startsWith("b/") ? path.slice(2) : path;
};

export const rightSideLines = (diffText) => {
  const lines = new Map();
  let current = null;
  let remainingOld = 0;
  let remainingNew = 0;
  let newLine = 0;
  for (const raw of String(diffText).split("\n")) {
    if (remainingOld > 0 || remainingNew > 0) {
      const marker = raw[0] ?? " ";
      if (marker === "\\") continue;
      if (marker === "+") {
        current?.add(newLine);
        newLine += 1;
        remainingNew -= 1;
      } else if (marker === "-") {
        remainingOld -= 1;
      } else {
        current?.add(newLine);
        newLine += 1;
        remainingOld -= 1;
        remainingNew -= 1;
      }
      continue;
    }
    if (raw.startsWith("diff --git ")) {
      current = null;
    } else if (raw.startsWith("+++ ")) {
      const path = newSidePath(raw);
      current = path === null ? null : (lines.get(path) ?? lines.set(path, new Set()).get(path));
    } else {
      const hunk = raw.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (hunk) {
        remainingOld = hunk[1] === undefined ? 1 : Number(hunk[1]);
        newLine = Number(hunk[2]);
        remainingNew = hunk[3] === undefined ? 1 : Number(hunk[3]);
      }
    }
  }
  return lines;
};
