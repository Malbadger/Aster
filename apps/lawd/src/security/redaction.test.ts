import { describe, expect, it } from "vitest";
import { Redactor } from "./redaction.js";

// Planted, obviously-fake secrets used ONLY in this isolated test (04 Forbidden
// actions permits planted-secret tests). None are real credentials.
const FAKE = {
  openai: "sk-abcdef0123456789ABCDEFGHijklmnopqrst",
  aws: "AKIAIOSFODNN7EXAMPLE",
  github: "ghp_0123456789abcdefghijklmnopqrstuvwx",
  jwt: "eyJhbGciOiAiSFMyNTY.eyJzdWIiOiAiMTIzNDU2.Xy1234567890abcdEF",
  privateKey: "-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----",
};

describe("Redactor — zero-tolerance secret detection", () => {
  const r = new Redactor();

  it("detects each built-in secret shape", () => {
    expect(r.isClean(FAKE.openai)).toBe(false);
    expect(r.isClean(FAKE.aws)).toBe(false);
    expect(r.isClean(FAKE.github)).toBe(false);
    expect(r.isClean(FAKE.jwt)).toBe(false);
    expect(r.isClean(FAKE.privateKey)).toBe(false);
  });

  it("reports the exact field path of a nested secret", () => {
    const obj = { a: { b: [{ token: "ok-name" }, { note: FAKE.openai }] } };
    const findings = r.scan(obj);
    expect(findings.some((f) => f.path === "$.a.b[1].note")).toBe(true);
  });

  it("treats a value under a sensitive key as a secret unless it is a plain env-var NAME", () => {
    expect(r.isClean({ apiKey: "some-long-random-value-1234567890" })).toBe(false);
    // An env-var NAME reference is allowed (it is not a secret value).
    expect(r.isClean({ reference: "OPENAI_API_KEY" })).toBe(true);
    expect(r.isClean({ authMethod: "env-var", reference: "MY_TOKEN_NAME" })).toBe(true);
  });

  it("assertClean throws a typed SECRET_DETECTED error and never echoes the secret", () => {
    try {
      r.assertClean({ config: { key: FAKE.aws } }, "connection input");
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as Error & { code?: string };
      expect(err.code).toBe("SECRET_DETECTED");
      expect(err.message).not.toContain(FAKE.aws); // the message reports paths, not values
      expect(err.message).toContain("$.config.key");
    }
  });

  it("redact replaces secrets while preserving structure", () => {
    const red = r.redact({ user: "alice", note: FAKE.openai, nested: { pw: "hunter2-longvalue" } });
    expect(red.user).toBe("alice");
    expect(red.note).toMatch(/^\[REDACTED:/);
    expect(JSON.stringify(red)).not.toContain(FAKE.openai);
  });

  it("honors configured (admin/user) secret patterns", () => {
    const r2 = new Redactor([{ name: "acme-internal", re: /ACME-[0-9]{6}/ }]);
    expect(r2.isClean("ticket ACME-123456 attached")).toBe(false);
    expect(r.isClean("ticket ACME-123456 attached")).toBe(true); // default redactor doesn't know it
  });

  it("passes clean, ordinary content", () => {
    expect(r.isClean({ provider: "ollama", label: "Local", model: "llama3.1:8b" })).toBe(true);
  });
});
