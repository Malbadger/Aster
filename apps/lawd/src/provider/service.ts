/**
 * Provider service (BUILD-D-006/007). Composes the connection store, the
 * credential broker, the redactor, and the network policy to answer the
 * provider/credential/offline operations. Every input is secret-scanned before
 * it is stored; stored connections carry status + a non-secret reference hint
 * only. Credential values never pass through here.
 */
import { randomUUID } from "node:crypto";
import type {
  AddConnectionInput,
  CredentialStatus,
  NetCheck,
  ProviderConnection,
} from "@law/contracts";
import type { ConnectionStore } from "./connection-store.js";
import type { CredentialBroker } from "../security/credential-broker.js";
import { Redactor } from "../security/redaction.js";
import { checkEndpoint, type NetPolicyState } from "../security/net-policy.js";

export interface ProviderServiceDeps {
  store: ConnectionStore;
  broker: CredentialBroker;
  redactor?: Redactor;
  /** Current network policy state (offline/remote authorization). */
  netState: () => NetPolicyState;
  now?: () => Date;
}

/** Auth methods that carry a resolvable reference hint. */
const REFERENCE_METHODS = new Set(["env-var", "external-command", "enterprise-broker"]);

export class ProviderService {
  private readonly redactor: Redactor;
  private readonly now: () => Date;

  constructor(private readonly deps: ProviderServiceDeps) {
    this.redactor = deps.redactor ?? new Redactor();
    this.now = deps.now ?? (() => new Date());
  }

  listConnections(): { connections: ProviderConnection[] } {
    return { connections: this.deps.store.list() };
  }

  addConnection(input: AddConnectionInput): { connection: ProviderConnection } {
    // Zero-tolerance: refuse any input that contains a secret (REQ-D-013).
    this.redactor.assertClean(input, "connection input");

    const needsRef = REFERENCE_METHODS.has(input.authMethod);
    if (needsRef && (!input.reference || input.reference.trim().length === 0)) {
      const err = new Error(`auth method "${input.authMethod}" requires a non-secret reference`) as Error & { code: string };
      err.code = "BAD_REQUEST";
      throw err;
    }

    const connection: ProviderConnection = {
      connectionId: `conn-${randomUUID().replace(/-/g, "").slice(0, 16)}`,
      provider: input.provider,
      label: input.label,
      authMethod: input.authMethod,
      locality: input.locality,
      enabled: true,
      status: "unknown",
      ...(needsRef && input.reference ? { referenceHint: input.reference.trim() } : {}),
    };
    this.deps.store.upsert(connection);
    return { connection };
  }

  removeConnection(connectionId: string): { removed: boolean } {
    return { removed: this.deps.store.remove(connectionId) };
  }

  setEnabled(connectionId: string, enabled: boolean): { connection: ProviderConnection } {
    const conn = this.deps.store.get(connectionId);
    if (!conn) {
      const err = new Error(`no such connection: ${connectionId}`) as Error & { code: string };
      err.code = "NOT_FOUND";
      throw err;
    }
    const updated = { ...conn, enabled };
    this.deps.store.upsert(updated);
    return { connection: updated };
  }

  async checkCredential(connectionId: string): Promise<{ connectionId: string; status: CredentialStatus; checkedAt: string }> {
    const conn = this.deps.store.get(connectionId);
    if (!conn) {
      const err = new Error(`no such connection: ${connectionId}`) as Error & { code: string };
      err.code = "NOT_FOUND";
      throw err;
    }
    const status = await this.deps.broker.availability({
      connectionId: conn.connectionId,
      authMethod: conn.authMethod,
      ...(conn.referenceHint ? { referenceHint: conn.referenceHint } : {}),
    });
    const checkedAt = this.now().toISOString();
    this.deps.store.upsert({ ...conn, status, checkedAt });
    return { connectionId, status, checkedAt };
  }

  checkEndpoint(target: string): NetCheck {
    return checkEndpoint(target, this.deps.netState());
  }
}
