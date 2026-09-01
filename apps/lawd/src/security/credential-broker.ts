/**
 * Credential broker (REQ-D-011/012/013). Resolves the AVAILABILITY of a
 * connection's credential across the supported auth methods and returns status
 * ONLY — never the value. Any secret material touched here (an external
 * command's stdout, a broker response) lives in a local variable for the
 * duration of the check and is discarded; it is never returned, stored, or
 * logged. There is no OS-keyring store (DEC-D-013).
 */
import type { AuthMethod, CredentialStatus } from "@law/contracts";

export interface CommandRunner {
  /** Run a resolver command; return exit code and captured stdout (a secret). */
  run(command: string): Promise<{ code: number; stdout: string }>;
}

export interface BrokerProbe {
  /** Report availability for an enterprise broker label, without revealing the value. */
  probe(label: string): Promise<CredentialStatus>;
}

export interface CredentialBrokerOptions {
  env?: Record<string, string | undefined>;
  runner?: CommandRunner;
  broker?: BrokerProbe;
  /** Session presence check for oauth-device (set true when a login handoff succeeded). */
  hasOauthSession?: (connectionId: string) => boolean;
}

export interface ConnResolvable {
  connectionId: string;
  authMethod: AuthMethod;
  /** Non-secret reference: env NAME, command line, or broker label. */
  referenceHint?: string;
}

export class CredentialBroker {
  private readonly env: Record<string, string | undefined>;
  private readonly runner?: CommandRunner;
  private readonly broker?: BrokerProbe;
  private readonly hasOauthSession: (connectionId: string) => boolean;

  constructor(opts: CredentialBrokerOptions = {}) {
    this.env = opts.env ?? process.env;
    this.runner = opts.runner;
    this.broker = opts.broker;
    this.hasOauthSession = opts.hasOauthSession ?? (() => false);
  }

  /** Resolve availability. Returns ONLY a status; the value never leaves this method. */
  async availability(conn: ConnResolvable): Promise<CredentialStatus> {
    switch (conn.authMethod) {
      case "none-local":
        return "available";

      case "env-var": {
        const name = (conn.referenceHint ?? "").trim();
        if (!name) return "error";
        const value = this.env[name]; // secret — read, never returned
        return value && value.length > 0 ? "available" : "absent";
      }

      case "external-command": {
        const command = (conn.referenceHint ?? "").trim();
        if (!command || !this.runner) return "unknown";
        try {
          const { code, stdout } = await this.runner.run(command);
          // stdout is a secret: inspect only its presence, then let it fall out of scope.
          const present = code === 0 && stdout.trim().length > 0;
          return present ? "available" : "absent";
        } catch {
          return "error";
        }
      }

      case "enterprise-broker": {
        const label = (conn.referenceHint ?? "").trim();
        if (!label || !this.broker) return "unknown";
        try {
          return await this.broker.probe(label);
        } catch {
          return "error";
        }
      }

      case "oauth-device":
        // Interactive login is human-only; Aster records only whether a session exists.
        return this.hasOauthSession(conn.connectionId) ? "available" : "absent";

      default:
        return "unknown";
    }
  }
}
