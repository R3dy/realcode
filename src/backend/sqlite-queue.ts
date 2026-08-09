import Database from "better-sqlite3";
import type { Database as DB } from "better-sqlite3";
import type { Queue, WorkItem, ItemStatus } from "./types.js";
import { randomUUID } from "crypto";

const LEASE_DEFAULT_MS = 10 * 60 * 1000;

export class SQLiteQueue implements Queue {
  private db: DB;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS work_items (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        worker_id TEXT,
        lease_expires_at INTEGER,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_status ON work_items(status);
      CREATE INDEX IF NOT EXISTS idx_run ON work_items(run_id);
    `);
  }

  publish(item: Omit<WorkItem, "id" | "created_at" | "updated_at" | "retry_count" | "worker_id" | "lease_expires_at">): string {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO work_items (id, run_id, stage, status, retry_count, worker_id, lease_expires_at, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, NULL, NULL, ?, ?, ?)`,
    ).run(id, item.run_id, item.stage, item.status, JSON.stringify(item.payload), now, now);
    return id;
  }

  claim(worker_id: string, eligible_statuses: string[], lease_ms: number = LEASE_DEFAULT_MS): WorkItem | null {
    // Safety net: terminal statuses are never eligible, even if passed
    const safe = eligible_statuses.filter((s) => !s.endsWith("_failed") && s !== "escalated");
    if (safe.length === 0) return null;
    const placeholders = safe.map(() => "?").join(",");
    const now = Date.now();
    const tx = this.db.transaction(() => {
      const row = this.db.prepare(
        `SELECT * FROM work_items
         WHERE status IN (${placeholders}) AND (lease_expires_at IS NULL OR lease_expires_at < ?)
         ORDER BY created_at ASC LIMIT 1`,
      ).get(...safe, now) as (Record<string, unknown> | undefined);

      if (!row) return null;

      // Set the lease; do NOT change the status — the dispatcher needs the original status
      // (e.g. "intake") to find the correct stage via findStageForStatus. The lease
      // (worker_id + lease_expires_at) is what prevents double-claiming, not a status change.
      this.db.prepare(
        `UPDATE work_items SET worker_id = ?, lease_expires_at = ?, updated_at = ? WHERE id = ?`,
      ).run(worker_id, now + lease_ms, now, row.id as string);

      return this.mapRow({ ...row, worker_id, lease_expires_at: now + lease_ms, updated_at: now });
    });
    return tx();
  }

  release(item_id: string, new_status: ItemStatus, _note?: string): void {
    const now = Date.now();
    this.db.prepare(
      `UPDATE work_items SET status = ?, worker_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?`,
    ).run(new_status, now, item_id);
  }

  annotate(_item_id: string, _note: string): void {
    // Notes stored in a separate table in production; for MVP, logged via tracing
  }

  get(item_id: string): WorkItem | null {
    const row = this.db.prepare(`SELECT * FROM work_items WHERE id = ?`).get(item_id) as (Record<string, unknown> | undefined);
    return row ? this.mapRow(row) : null;
  }

  list_by_run(run_id: string): WorkItem[] {
    const rows = this.db.prepare(`SELECT * FROM work_items WHERE run_id = ? ORDER BY created_at`).all(run_id) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  list_by_status(statuses: string[]): WorkItem[] {
    const placeholders = statuses.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT * FROM work_items WHERE status IN (${placeholders}) ORDER BY created_at`).all(...statuses) as Record<string, unknown>[];
    return rows.map((r) => this.mapRow(r));
  }

  expire_leases(): number {
    const now = Date.now();
    const expired = this.db.prepare(
      `SELECT id, retry_count FROM work_items WHERE lease_expires_at IS NOT NULL AND lease_expires_at < ? AND worker_id IS NOT NULL`,
    ).all(now) as { id: string; retry_count: number }[];

    const update = this.db.prepare(
      `UPDATE work_items SET status = CASE WHEN retry_count >= 2 THEN 'escalated' ELSE status END,
       worker_id = NULL, lease_expires_at = NULL, retry_count = retry_count + 1, updated_at = ? WHERE id = ?`,
    );

    const tx = this.db.transaction(() => {
      let count = 0;
      for (const e of expired) {
        update.run(now, e.id);
        count++;
      }
      return count;
    });
    return tx();
  }

  close(): void {
    this.db.close();
  }

  private mapRow(row: Record<string, unknown>): WorkItem {
    return {
      id: row.id as string,
      run_id: row.run_id as string,
      stage: row.stage as string,
      status: row.status as string,
      retry_count: row.retry_count as number,
      worker_id: (row.worker_id as string) ?? null,
      lease_expires_at: (row.lease_expires_at as number) ?? null,
      payload: JSON.parse(row.payload as string),
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    };
  }
}
