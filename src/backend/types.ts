export type ItemStatus = string;

export interface WorkItem {
  id: string;
  run_id: string;
  stage: string;
  status: ItemStatus;
  retry_count: number;
  worker_id: string | null;
  lease_expires_at: number | null;
  payload: Record<string, unknown>;
  created_at: number;
  updated_at: number;
}

export interface Queue {
  publish(item: Omit<WorkItem, "id" | "created_at" | "updated_at" | "retry_count" | "worker_id" | "lease_expires_at">): string;
  claim(worker_id: string, eligible_statuses: string[], lease_ms?: number): WorkItem | null;
  release(item_id: string, new_status: ItemStatus, note?: string): void;
  annotate(item_id: string, note: string): void;
  get(item_id: string): WorkItem | null;
  list_by_run(run_id: string): WorkItem[];
  list_by_status(statuses: string[]): WorkItem[];
  expire_leases(): number;
  close(): void;
}

export interface Storage {
  write(path: string, data: string | Buffer): void;
  read(path: string): string | null;
  list(prefix: string): string[];
  delete(path: string): void;
  exists(path: string): boolean;
  mkdirSync?(path: string): void;
}
