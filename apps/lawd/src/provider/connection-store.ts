/**
 * Provider connection store (REQ-D-010). Persists connections locally under
 * `${lawRoot}/.law/desktop-connections.json` (0600). Stores STATUS and a
 * non-secret reference hint only — never a credential value. The service layer
 * secret-scans every input before it reaches this store.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProviderConnection } from "@law/contracts";

export interface ConnectionStore {
  list(): ProviderConnection[];
  get(connectionId: string): ProviderConnection | undefined;
  upsert(conn: ProviderConnection): void;
  remove(connectionId: string): boolean;
}

export class FileConnectionStore implements ConnectionStore {
  constructor(private readonly path: string) {}

  static forRoot(lawRoot: string): FileConnectionStore {
    return new FileConnectionStore(join(lawRoot, ".law", "desktop-connections.json"));
  }

  private read(): ProviderConnection[] {
    if (!existsSync(this.path)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      return Array.isArray(parsed) ? (parsed as ProviderConnection[]) : [];
    } catch {
      return [];
    }
  }

  private write(conns: ProviderConnection[]): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(conns, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  list(): ProviderConnection[] {
    return this.read();
  }
  get(connectionId: string): ProviderConnection | undefined {
    return this.read().find((c) => c.connectionId === connectionId);
  }
  upsert(conn: ProviderConnection): void {
    const conns = this.read();
    const i = conns.findIndex((c) => c.connectionId === conn.connectionId);
    if (i >= 0) conns[i] = conn;
    else conns.push(conn);
    this.write(conns);
  }
  remove(connectionId: string): boolean {
    const conns = this.read();
    const next = conns.filter((c) => c.connectionId !== connectionId);
    if (next.length === conns.length) return false;
    this.write(next);
    return true;
  }
}

export class MemoryConnectionStore implements ConnectionStore {
  private conns: ProviderConnection[] = [];
  list(): ProviderConnection[] {
    return [...this.conns];
  }
  get(connectionId: string): ProviderConnection | undefined {
    return this.conns.find((c) => c.connectionId === connectionId);
  }
  upsert(conn: ProviderConnection): void {
    const i = this.conns.findIndex((c) => c.connectionId === conn.connectionId);
    if (i >= 0) this.conns[i] = conn;
    else this.conns.push(conn);
  }
  remove(connectionId: string): boolean {
    const before = this.conns.length;
    this.conns = this.conns.filter((c) => c.connectionId !== connectionId);
    return this.conns.length < before;
  }
}
