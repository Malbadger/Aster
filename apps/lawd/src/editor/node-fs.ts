import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
};
