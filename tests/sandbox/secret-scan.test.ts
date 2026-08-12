import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { scanForSecrets } from "../../src/sandbox/secret-scan.js";

describe("sandbox/secret-scan: scanForSecrets", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-scan-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fires on a seeded OpenAI-key-style value (sk-...)", () => {
    fs.writeFileSync(
      path.join(tmpDir, "opencode.json"),
      JSON.stringify({ note: "sk-test1234567890abcdef" }, null, 2),
    );
    const hits = scanForSecrets(tmpDir);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].file).toBe("opencode.json");
    // The pattern field names the matched pattern family — NEVER the value.
    expect(hits[0].pattern).toMatch(/literal-secret-prefix|model-provider-env-key/);
    expect(hits[0].pattern).not.toContain("sk-test");
  });

  it("fires on AWS access key prefix (AKIA...)", () => {
    fs.writeFileSync(path.join(tmpDir, "config.yaml"), "aws_key: AKIAIOSFODNN7EXAMPLE9876");
    const hits = scanForSecrets(tmpDir);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].file).toBe("config.yaml");
  });

  it("fires on GitHub personal access token prefix (ghp_...)", () => {
    fs.writeFileSync(path.join(tmpDir, "ci.env"), "GITHUB_PAT=ghp_abcdefghijklmnopqrstuvwxyz0123456789AB");
    const hits = scanForSecrets(tmpDir);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].file).toBe("ci.env");
  });

  it("fires on a model-provider env-var-name reference (OPENAI_API_KEY as a string in a config file)", () => {
    fs.writeFileSync(
      path.join(tmpDir, "opencode.json"),
      JSON.stringify({ env_ref: "OPENAI_API_KEY" }, null, 2),
    );
    const hits = scanForSecrets(tmpDir);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].pattern).toBe("model-provider-env-key");
  });

  it("returns [] on a clean fixture (no key-like content)", () => {
    fs.writeFileSync(
      path.join(tmpDir, "opencode.json"),
      JSON.stringify({ mcp: { codebase: { command: ["/abs/path/to/bin"] } } }, null, 2),
    );
    expect(scanForSecrets(tmpDir)).toEqual([]);
  });

  it("returns [] when the dir does not exist", () => {
    expect(scanForSecrets("/nonexistent/path/that/does/not/exist")).toEqual([]);
  });

  it("never includes the matched secret value in the result (only file + pattern family)", () => {
    const secretValue = "sk-test1234567890abcdefSECRETVALUE";
    fs.writeFileSync(path.join(tmpDir, "opencode.json"), `{"x":"${secretValue}"}`);
    const hits = scanForSecrets(tmpDir);
    expect(hits.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(hits);
    expect(serialized).not.toContain(secretValue);
  });

  it("skips node_modules/ and .git/ directories", () => {
    fs.mkdirSync(path.join(tmpDir, "node_modules"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "node_modules", "pkg.json"), '{"x":"sk-test1234567890abcdefLEAK"}');
    fs.writeFileSync(path.join(tmpDir, ".git", "config"), "token = ghp_shouldnotbescanned0123456789AB");
    fs.writeFileSync(path.join(tmpDir, "opencode.json"), "{}");
    expect(scanForSecrets(tmpDir)).toEqual([]);
  });

  it("walks subdirectories recursively (finds secrets in nested config files)", () => {
    fs.mkdirSync(path.join(tmpDir, "agents"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "agents", "secret-agent.json"), '{"key":"sk-test1234567890abcdefNESTED"}');
    const hits = scanForSecrets(tmpDir);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].file).toBe(path.join("agents", "secret-agent.json"));
  });

  it("only scans *.json / *.yaml / *.yml / *.env / .env files (ignores *.md, *.ts, etc.)", () => {
    fs.writeFileSync(path.join(tmpDir, "notes.md"), "My key is sk-test1234567890abcdefIGNORE");
    fs.writeFileSync(path.join(tmpDir, "code.ts"), 'const x = "sk-test1234567890abcdefIGNORE";');
    fs.writeFileSync(path.join(tmpDir, "opencode.json"), "{}");
    expect(scanForSecrets(tmpDir)).toEqual([]);
  });
});
