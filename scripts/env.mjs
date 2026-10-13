import { readFileSync } from "node:fs";
export function parseEnv(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error("Invalid environment file entry.");
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "").trim();
    values[match[1]] = value;
  }
  return values;
}
export function loadEnv(root, overrides = process.env) {
  let local = {};
  try { local = parseEnv(readFileSync(new URL(".env.local", root), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return { ...local, ...overrides };
}
