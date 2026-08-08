import * as fs from "fs";
import * as path from "path";
import type { Storage } from "./types.js";

export class FileStorage implements Storage {
  private root: string;

  constructor(root: string) {
    this.root = root;
    fs.mkdirSync(root, { recursive: true });
  }

  write(p: string, data: string | Buffer): void {
    const full = this.resolve(p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    const tmp = `${full}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, full);
  }

  read(p: string): string | null {
    const full = this.resolve(p);
    if (!fs.existsSync(full)) return null;
    return fs.readFileSync(full, "utf8");
  }

  list(prefix: string): string[] {
    const full = this.resolve(prefix);
    if (!fs.existsSync(full)) return [];
    const results: string[] = [];
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const fullpath = path.join(dir, e.name);
        if (e.isDirectory()) walk(fullpath);
        else results.push(path.relative(this.root, fullpath));
      }
    };
    walk(full);
    return results.sort();
  }

  delete(p: string): void {
    const full = this.resolve(p);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }

  exists(p: string): boolean {
    return fs.existsSync(this.resolve(p));
  }

  private resolve(p: string): string {
    const full = path.resolve(this.root, p);
    if (!full.startsWith(this.root)) {
      throw new Error(`Path traversal blocked: ${p}`);
    }
    return full;
  }
}
