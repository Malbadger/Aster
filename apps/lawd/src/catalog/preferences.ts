/**
 * File-backed local preferences (favorites + recent models). Stored under
 * `${lawRoot}/.law/desktop-preferences.json`, 0600, atomic write. Contains no
 * credentials and does not change run identity (REQ-D-008).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PreferencesStore } from "../ports.js";

interface PrefsFile {
  favorites: string[];
  recent: string[];
}

const RECENT_LIMIT = 12;

export class FilePreferencesStore implements PreferencesStore {
  constructor(private readonly path: string) {}

  static forRoot(lawRoot: string): FilePreferencesStore {
    return new FilePreferencesStore(join(lawRoot, ".law", "desktop-preferences.json"));
  }

  private read(): PrefsFile {
    if (!existsSync(this.path)) return { favorites: [], recent: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<PrefsFile>;
      return {
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites.filter((x) => typeof x === "string") : [],
        recent: Array.isArray(parsed.recent) ? parsed.recent.filter((x) => typeof x === "string") : [],
      };
    } catch {
      return { favorites: [], recent: [] };
    }
  }

  private write(data: PrefsFile): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  getFavorites(): string[] {
    return this.read().favorites;
  }

  setFavorite(modelId: string, favorite: boolean): string[] {
    const data = this.read();
    const set = new Set(data.favorites);
    if (favorite) set.add(modelId);
    else set.delete(modelId);
    data.favorites = [...set];
    this.write(data);
    return data.favorites;
  }

  getRecent(): string[] {
    return this.read().recent;
  }

  addRecent(modelId: string): void {
    const data = this.read();
    data.recent = [modelId, ...data.recent.filter((x) => x !== modelId)].slice(0, RECENT_LIMIT);
    this.write(data);
  }
}

/** In-memory store for tests. */
export class MemoryPreferencesStore implements PreferencesStore {
  private favorites: string[] = [];
  private recent: string[] = [];
  constructor(init?: { favorites?: string[]; recent?: string[] }) {
    this.favorites = init?.favorites ?? [];
    this.recent = init?.recent ?? [];
  }
  getFavorites(): string[] {
    return [...this.favorites];
  }
  setFavorite(modelId: string, favorite: boolean): string[] {
    const set = new Set(this.favorites);
    if (favorite) set.add(modelId);
    else set.delete(modelId);
    this.favorites = [...set];
    return this.getFavorites();
  }
  getRecent(): string[] {
    return [...this.recent];
  }
  addRecent(modelId: string): void {
    this.recent = [modelId, ...this.recent.filter((x) => x !== modelId)].slice(0, 12);
  }
}
