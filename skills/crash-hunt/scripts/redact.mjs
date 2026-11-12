export const redacted = "[redacted]";

const sensitiveHeader = /^(?:authorization|proxy-authorization|cookie|set-cookie)$|token|secret|api-?key|session|password/i;
const tokenPatterns = [
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]*/g,
  /\b(?:Bearer|Basic|Digest|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];
const opaqueRun = /[A-Za-z0-9_-]{32,}/g;
const canonicalUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mixesLettersAndDigits = (text) => /\d/.test(text) && /[A-Za-z]/.test(text);

export const isSensitiveHeader = (name) => sensitiveHeader.test(String(name).trim());

export const scrub = (text, secrets = []) => {
  if (typeof text !== "string" || text === "") return text;
  let clean = text;
  for (const secret of secrets) clean = clean.split(secret).join(redacted);
  for (const pattern of tokenPatterns) clean = clean.replace(pattern, redacted);
  return clean.replace(opaqueRun, (run) => (mixesLettersAndDigits(run) && !canonicalUuid.test(run) ? redacted : run));
};

export const isTokenShaped = (text) => scrub(text) !== text;

export const secretValues = (pairs) =>
  pairs
    .filter(([name, value]) => isSensitiveHeader(name) || isTokenShaped(value))
    .flatMap(([, value]) => [value, ...value.split(/\s+/).filter((part) => part.length >= 8)])
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

export const redactHeaders = (pairs, secrets = []) => pairs.map(([name, value]) => [name, isSensitiveHeader(name) ? redacted : scrub(value, secrets)]);

const redactHeaderLine = (line, secrets) => {
  const separator = line.indexOf(":");
  const name = separator > 0 ? line.slice(0, separator) : "";
  return name && isSensitiveHeader(name) ? `${name}: ${redacted}` : scrub(line, secrets);
};

export const redactCase = (testCase, secrets = []) => ({
  ...testCase,
  target: scrub(testCase.target, secrets),
  headers: redactHeaders(testCase.headers, secrets),
  body: scrub(testCase.body, secrets),
  raw: testCase.raw && { ...testCase.raw, headers: testCase.raw.headers.map((line) => redactHeaderLine(line, secrets)), body: scrub(testCase.raw.body, secrets) },
});
