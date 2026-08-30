/**
 * Autocomplete service (REQ-D-031/032). Opt-in and disabled by default,
 * independently configured from the chat model. A completion is refused unless
 * explicitly enabled and a model is chosen; the response always discloses the
 * locality of the model that would run. A `Completer` port supplies suggestions
 * (bound to a provider on Ubuntu; a fake in tests).
 */
import type { AutocompleteConfig } from "@law/contracts";

export interface CompleteRequest {
  path: string;
  prefix: string;
  suffix: string;
  config: AutocompleteConfig;
}

export type Completer = (req: CompleteRequest) => Promise<string> | string;

export interface AutocompleteResult {
  enabled: boolean;
  suggestion?: string;
  locality: "local" | "remote" | "unknown";
  reason?: string;
}

export class AutocompleteService {
  private config: AutocompleteConfig = { enabled: false, locality: "unknown", maxTokens: 64 };

  constructor(private readonly completer?: Completer) {}

  getConfig(): AutocompleteConfig {
    return this.config;
  }

  setConfig(config: AutocompleteConfig): AutocompleteConfig {
    this.config = config;
    return this.config;
  }

  async complete(input: { path: string; prefix: string; suffix: string }): Promise<AutocompleteResult> {
    if (!this.config.enabled) {
      return { enabled: false, locality: this.config.locality, reason: "autocomplete is disabled (opt-in, off by default)" };
    }
    if (!this.config.modelId || !this.completer) {
      return { enabled: true, locality: this.config.locality, reason: "no autocomplete model configured" };
    }
    const suggestion = await this.completer({ ...input, config: this.config });
    return { enabled: true, suggestion, locality: this.config.locality };
  }
}
