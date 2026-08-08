import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SQLiteQueue } from "../src/backend/sqlite-queue.js";
import { FileStorage } from "../src/backend/file-storage.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("SQLiteQueue atomic claim", () => {
  it("two concurrent workers never claim the same item", () => {
    const q = new SQLiteQueue(path.join(tmpDir, "test.db"));
    for (let i = 0; i < 20; i++) {
      q.publish({
        run_id: "run_test",
        stage: "frame",
        status: "intake",
        payload: { idea: `idea-${i}` },
      });
    }

    const claimed = new Set<string>();
    const w1 = [];
    const w2 = [];
    let done = false;
    while (!done) {
      const a = q.claim("worker-1", ["intake"]);
      const b = q.claim("worker-2", ["intake"]);
      if (a) { w1.push(a.id); claimed.add(a.id); }
      if (b) { w2.push(b.id); claimed.add(b.id); }
      if (!a && !b) done = true;
      if (a) q.release(a.id, "framed");
      if (b) q.release(b.id, "framed");
    }

    expect(claimed.size).toBe(20);
    expect(w1.length + w2.length).toBe(20);
    // No overlap
    const overlap = w1.filter((x) => w2.includes(x));
    expect(overlap.length).toBe(0);
    q.close();
  });

  it("claim returns null when no eligible items", () => {
    const q = new SQLiteQueue(path.join(tmpDir, "empty.db"));
    const item = q.claim("worker-1", ["intake"]);
    expect(item).toBe(null);
    q.close();
  });

  it("failed status is terminal (never re-claimed)", () => {
    const q = new SQLiteQueue(path.join(tmpDir, "terminal.db"));
    const id = q.publish({
      run_id: "run_test",
      stage: "frame",
      status: "framing_failed",
      payload: {},
    });
    const claimed = q.claim("worker-1", ["framing_failed"]);
    expect(claimed).toBe(null);
    q.close();
  });

  it("lease expiry re-eligibilizes a crashed worker's item with retry_count increment", () => {
    const q = new SQLiteQueue(path.join(tmpDir, "lease.db"));
    const id = q.publish({
      run_id: "run_test",
      stage: "frame",
      status: "intake",
      payload: {},
    });
    // Claim with a short lease
    q.claim("worker-crash", ["intake"], 50);
    // Wait for lease to expire
    const slept = sleep(80);
    expect(slept).toBe(true);

    const expired = q.expire_leases();
    expect(expired).toBe(1);

    // Item should be eligible again
    const reclaimed = q.claim("worker-2", ["intake", "eligible"]);
    expect(reclaimed).not.toBe(null);
    expect(reclaimed!.retry_count).toBe(1);
    q.close();
  });
});

describe("FileStorage", () => {
  it("writes and reads a file", () => {
    const s = new FileStorage(tmpDir);
    s.write("runs/run_1/output.txt", "hello world");
    expect(s.read("runs/run_1/output.txt")).toBe("hello world");
  });

  it("returns null for missing file", () => {
    const s = new FileStorage(tmpDir);
    expect(s.read("nonexistent.txt")).toBe(null);
  });

  it("lists files by prefix", () => {
    const s = new FileStorage(tmpDir);
    s.write("runs/1.txt", "a");
    s.write("runs/2.txt", "b");
    s.write("other/3.txt", "c");
    const files = s.list("runs");
    expect(files.length).toBe(2);
    expect(files).toContain("runs/1.txt");
    expect(files).toContain("runs/2.txt");
  });

  it("blocks path traversal", () => {
    const s = new FileStorage(tmpDir);
    expect(() => s.read("../../../etc/passwd")).toThrow();
  });

  it("delete removes a file", () => {
    const s = new FileStorage(tmpDir);
    s.write("to-delete.txt", "x");
    expect(s.exists("to-delete.txt")).toBe(true);
    s.delete("to-delete.txt");
    expect(s.exists("to-delete.txt")).toBe(false);
  });
});

function sleep(ms: number): boolean {
  const start = Date.now();
  while (Date.now() - start < ms) { /* busy wait */ }
  return true;
}
