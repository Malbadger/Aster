/**
 * Real capability probe (BUILD-D-003, REQ-D-002).
 *
 * Binds to the existing LAW Core compiled output rather than reimplementing it:
 *   - `createPiAdapter().capabilities()` for Pi/adapter/provider/container/models
 *   - `buildDoctorReport()` for the qualified status taxonomy
 *   - LAW Core's own loopback Ollama probe
 * plus a Git probe. It performs no install or download and returns the
 * provider-neutral CapabilityProbe contract. It executes only where the LAW
 * Core dist exists on the operator's machine; tests use a fake CapabilityProbePort.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CapabilityProbe, CapabilityReport } from "@law/contracts";
import type { CapabilityProbePort } from "../ports.js";
import { detectGit } from "./git.js";

/** Find the LAW repository root (the package.json named `law-pi`). */
export function findLawRoot(startDir = process.env.LAW_ROOT ?? process.cwd()): string {
  let dir = resolve(startDir);
  for (let i = 0; i < 12; i += 1) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, "utf8")) as { name?: string };
        if (parsed.name === "law-pi") return dir;
      } catch {
        /* keep walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(startDir);
}

async function importCore<T>(lawRoot: string, rel: string): Promise<T> {
  const url = pathToFileURL(join(lawRoot, "dist", rel)).href;
  return (await import(url)) as T;
}

export class LawCoreProbe implements CapabilityProbePort {
  private cached: CapabilityProbe | undefined;

  constructor(private readonly lawRoot: string = findLawRoot()) {}

  async probe(refresh: boolean): Promise<CapabilityProbe> {
    if (this.cached && !refresh) return this.cached;

    const capabilities: CapabilityReport[] = [];
    const coreDist = join(this.lawRoot, "dist", "pi-adapter", "index.js");

    if (!existsSync(coreDist)) {
      capabilities.push({
        id: "law-core",
        displayName: "LAW Core",
        state: "missing",
        optional: false,
        detail: "LAW Core build output not found",
        recovery: "run `npm run build` to compile LAW Core (src/ -> dist/)",
      });
      const probe: CapabilityProbe = { probedAt: new Date().toISOString(), capabilities };
      this.cached = probe;
      return probe;
    }

    const piMod = await importCore<{ createPiAdapter: () => { capabilities(): Promise<any>; id: string; adapterVersion: string } }>(
      this.lawRoot,
      "pi-adapter/index.js",
    );
    const adapter = piMod.createPiAdapter();
    const caps = await adapter.capabilities();

    capabilities.push({
      id: "law-core",
      displayName: "LAW Core",
      state: "ready",
      optional: false,
      detail: `LAW Core available; adapter ${caps.adapter.id}@${caps.adapter.version}`,
    });

    // Pi runtime.
    const piState: CapabilityReport["state"] =
      caps.pi.source === "missing" || caps.pi.version === null
        ? "missing"
        : caps.pi.compatible
          ? "ready"
          : "incompatible";
    capabilities.push({
      id: "pi",
      displayName: "Pi coding agent",
      state: piState,
      optional: false,
      ...(caps.pi.version ? { detectedVersion: caps.pi.version } : {}),
      requiredVersion: caps.pi.testedRange,
      detail:
        piState === "ready"
          ? `Pi ${caps.pi.version} (qualified)`
          : piState === "incompatible"
            ? `Pi ${caps.pi.version} outside tested range ${caps.pi.testedRange}`
            : "Pi qualification target not installed",
      ...(piState === "ready"
        ? {}
        : { recovery: "install/qualify the project-local Pi target before model runs" }),
    });

    // Local model endpoint (Ollama over loopback).
    let ollamaReachable = false;
    try {
      const probes = await importCore<{ ollamaLoopbackReachable: (p?: number, t?: number) => Promise<boolean> }>(
        this.lawRoot,
        "pi-adapter/probes.js",
      );
      ollamaReachable = await probes.ollamaLoopbackReachable();
    } catch {
      ollamaReachable = false;
    }
    capabilities.push({
      id: "ollama",
      displayName: "Local model endpoint (Ollama)",
      state: ollamaReachable ? "ready" : "unavailable",
      optional: true,
      detail: ollamaReachable
        ? "reachable on 127.0.0.1:11434"
        : "no local model endpoint reachable on loopback",
      ...(ollamaReachable ? {} : { recovery: "start Ollama (or another loopback endpoint) for offline local models" }),
    });

    // Container engine (from LAW Core capabilities).
    capabilities.push({
      id: "container",
      displayName: "Container engine",
      state: caps.container.available ? "ready" : "unavailable",
      optional: true,
      detail: caps.container.detail ?? (caps.container.available ? "available" : "no docker or podman engine"),
      ...(caps.container.available ? {} : { recovery: "install docker or podman to enable unattended isolated runs" }),
    });

    // Git.
    const git = await detectGit();
    capabilities.push({
      id: "git",
      displayName: "Git",
      state: git.available ? "ready" : "missing",
      optional: true,
      ...(git.version ? { detectedVersion: git.version } : {}),
      detail: git.detail,
      ...(git.available ? {} : { recovery: "install Git to enable version-control collaboration" }),
    });

    const probe: CapabilityProbe = { probedAt: new Date().toISOString(), capabilities };
    this.cached = probe;
    return probe;
  }
}
