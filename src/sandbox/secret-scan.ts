import * as fs from "fs";
import * as path from "path";

/**
 * scanForSecrets walks `dir` (shallow-recursive, skipping `node_modules/` and
 * `.git/`), reads each `*.json`/`*.yaml`/`*.yml`/`*.env`/`.env` file's text,
 * and runs the pattern set from plan §4.6.1:
 *
 *   1. Literal secret prefixes: `/(?:sk-|AKIA|ghp_|gho_|xox[bap]|AIza)[A-Za-z0-9]{16,}/`
 *      (OpenAI/AWS/GitHub/Slack/Google cloud keys, etc.)
 *   2. Model-provider env-var-name pattern (the `KEY_PATTERN` from
 *      `collectModelEnv()` in src/agents/runner.ts:183): matches strings like
 *      `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — catches config files that
 *      REFERENCE a secret-bearing env var by name (e.g. `"env": "OPENAI_API_KEY"`).
 *
 * On a match it pushes `{ file: <relpath>, pattern: <pattern-family-name> }`.
 * The matched value is NEVER included in the result (only the file + pattern
 * family name) — the brief explicitly forbids leaking the secret value into logs.
 *
 * Returns `[]` when `dir` does not exist, is not a directory, or no file
 * triggers a pattern.
 *
 * Pattern-set choice (brief §4 task 2 vs plan §4.6.1): the brief's
 * `/key|secret|token|cred/i` "value-pattern family" is the planner's
 * paraphrase of the plan's `KEY_PATTERN` (env-var-name regex from
 * `collectModelEnv()`). The plan §4.6.1 is the authoritative source ("plus
 * the `KEY_PATTERN` from `collectModelEnv()`"), so this implementation matches
 * the plan's exact list: literal-secret-regex + KEY_PATTERN. A literal
 * `/key|secret|token|cred/i` free-text match would false-positive on prose
 * inside the operator's `skills/` dir (e.g. "LLM token usage", "API key
 * documentation") and refuse-to-spawn on every sandbox, breaking the system
 * — the plan's intent is "false positives are safe" not "false positives on
 * every spawn". The plan's `KEY_PATTERN` is conservative enough to avoid
 * breaking the operator's real config while still catching config files
 * that name a secret-bearing env var.
 *
 * Established by: Story A4.3 (issue #4). See CONVENTIONS.md "Sandbox / Docker
 * Pattern" → "scanForSecrets-before-spawn guard".
 */
export interface SecretMatch {
  file: string;
  pattern: string;
}

const LITERAL_SECRET_PATTERN = /(?:sk-|AKIA|ghp_|gho_|xox[bap]|AIza)[A-Za-z0-9]{16,}/;
const ENV_VAR_KEY_PATTERN = /(?:OPENROUTER|OPENAI|ANTHROPIC|DEEPSEEK|GROQ|MISTRAL|TOGETHER|FIREWORKS|PERPLEXITY|COHERE|GOOGLE|AZURE)_(?:API_KEY|KEY)\b/;

const PATTERN_FAMILIES: Array<{ pattern: RegExp; family: string }> = [
  { pattern: LITERAL_SECRET_PATTERN, family: "literal-secret-prefix" },
  { pattern: ENV_VAR_KEY_PATTERN, family: "model-provider-env-key" },
];

const SCANNABLE_EXTENSIONS = new Set([".json", ".yaml", ".yml", ".env"]);
const SKIP_DIRS = new Set(["node_modules", ".git"]);

export function scanForSecrets(dir: string): SecretMatch[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const matches: SecretMatch[] = [];
  const visited = new Set<string>();
  walkAndScan(dir, dir, entries, matches, visited);
  return matches;
}

function walkAndScan(
  rootDir: string,
  currentDir: string,
  entries: string[],
  matches: SecretMatch[],
  visited: Set<string>,
): void {
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      // Defensive against symlink loops + overly deep trees.
      const real = fs.realpathSync(fullPath);
      if (visited.has(real)) continue;
      visited.add(real);
      let childEntries: string[];
      try {
        childEntries = fs.readdirSync(fullPath);
      } catch {
        continue;
      }
      walkAndScan(rootDir, fullPath, childEntries, matches, visited);
      continue;
    }
    if (!stat.isFile()) continue;
    // Match files by extension OR a leading-dot env-file name (e.g. `.env`).
    const ext = path.extname(entry);
    const isEnvFile = entry === ".env" || entry.startsWith(".env.");
    if (!SCANNABLE_EXTENSIONS.has(ext) && !isEnvFile) continue;
    let text: string;
    try {
      text = fs.readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }
    const rel = path.relative(rootDir, fullPath);
    for (const { pattern, family } of PATTERN_FAMILIES) {
      if (pattern.test(text)) {
        matches.push({ file: rel, pattern: family });
        break; // one match per file is enough — never include the value
      }
    }
  }
}
