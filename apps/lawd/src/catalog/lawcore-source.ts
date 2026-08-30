/**
 * Real model source (BUILD-D-005). Binds to LAW Core:
 *   - `listOllamaModels()` for installed local models over loopback
 *   - `createPiAdapter().capabilities().providers` for configured providers
 * and maps both to provider-neutral ModelDescriptors. No model name drives
 * logic. Effort support is a conservative neutral default until adapters report
 * per-model effort maps (recorded as a provisional capability, not a silent
 * assumption). Executes where LAW Core `dist/` exists on the operator's machine; tests
 * use a fake ModelSourcePort.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { EffortLevel, ModelDescriptor } from "@law/contracts";
import type { ModelSourcePort } from "../ports.js";

const LOCAL_EFFORT: EffortLevel[] = ["low", "medium", "high"];
const REMOTE_EFFORT: EffortLevel[] = ["minimal", "low", "medium", "high", "max"];

async function importCore<T>(lawRoot: string, rel: string): Promise<T> {
  return (await import(pathToFileURL(join(lawRoot, "dist", rel)).href)) as T;
}

export class LawCoreModelSource implements ModelSourcePort {
  constructor(private readonly lawRoot: string) {}

  async descriptors(): Promise<ModelDescriptor[]> {
    const out: ModelDescriptor[] = [];

    // Local models via Ollama loopback (optional; empty when unreachable).
    try {
      const svc = await importCore<{ listOllamaModels: () => Promise<Array<{ name: string; parameter_size?: string; family?: string }>> }>(
        this.lawRoot,
        "mcp/local-service.js",
      );
      const models = await svc.listOllamaModels();
      for (const m of models) {
        out.push({
          id: `ollama:${m.name}`,
          displayName: m.name,
          provider: "ollama",
          locality: "local",
          availability: "available",
          effort: { supported: LOCAL_EFFORT },
          capabilities: { tools: false, vision: false },
          ...(m.parameter_size ? { note: `${m.parameter_size}${m.family ? ` · ${m.family}` : ""}` } : {}),
        });
      }
    } catch {
      // No local endpoint reachable — leave local models out; not an error.
    }

    // Configured providers via LAW Core capabilities.
    if (existsSync(join(this.lawRoot, "dist", "pi-adapter", "index.js"))) {
      try {
        const piMod = await importCore<{ createPiAdapter: () => { capabilities(): Promise<any> } }>(
          this.lawRoot,
          "pi-adapter/index.js",
        );
        const caps = await piMod.createPiAdapter().capabilities();
        for (const p of caps.providers as Array<{ id: string; authAvailable: string; locality: string }>) {
          const availability =
            p.authAvailable === "available" ? "available" : p.authAvailable === "unknown" ? "unknown" : "auth-needed";
          out.push({
            id: `${p.id}:default`,
            displayName: p.id,
            provider: p.id,
            locality: p.locality === "local" ? "local" : "remote",
            availability: availability as ModelDescriptor["availability"],
            effort: { supported: p.locality === "local" ? LOCAL_EFFORT : REMOTE_EFFORT },
            capabilities: { tools: true, vision: false },
            ...(availability === "auth-needed" ? { note: "sign-in required" } : {}),
          });
        }
      } catch {
        // Capabilities unavailable (e.g. Pi missing) — local models still list.
      }
    }

    return out;
  }
}
