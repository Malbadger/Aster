import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import type { FsPort } from "./editor-service.js";

/** Real filesystem port for the editor service. Paths are contained by the service. */
export const nodeFs: FsPort = {
  read: (path) => readFileSync(path, "utf8"),
  write: (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  },
  exists: (path) => existsSync(path),
  list: (path) => readdirSync(path, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    kind: entry.isSymbolicLink() ? "symlink" as const : entry.isDirectory() ? "directory" as const : "file" as const,
  })),
};
