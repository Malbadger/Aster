/**
 * Real external-credential command runner. Executes a user-configured resolver
 * command with a timeout and captures stdout. The captured value is a secret and
 * is handled only by the CredentialBroker, which inspects presence and discards
 * it; it is never logged or returned. Errors and timeouts fail closed.
 */
import { exec } from "node:child_process";
import type { CommandRunner } from "./credential-broker.js";

export class SpawnCommandRunner implements CommandRunner {
  constructor(private readonly timeoutMs = 10_000) {}

  run(command: string): Promise<{ code: number; stdout: string }> {
    return new Promise((resolve) => {
      exec(command, { timeout: this.timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) {
          const code = typeof (err as { code?: number }).code === "number" ? (err as { code: number }).code : 1;
          resolve({ code, stdout: "" });
          return;
        }
        resolve({ code: 0, stdout });
      });
    });
  }
}
