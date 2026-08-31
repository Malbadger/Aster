import { describe, expect, it } from "vitest";
import { interpret } from "./interpret.js";

describe("interpret (REQ-D-014)", () => {
  it("treats plain text as natural language", () => {
    const p = interpret("refactor the parser");
    expect(p.interpretation.type).toBe("natural-language");
    expect(p.prompt).toBe("refactor the parser");
  });

  it("parses a known slash command with args", () => {
    const p = interpret("/run build the project");
    expect(p.interpretation.type).toBe("slash-command");
    expect(p.command).toBe("run");
    expect(p.prompt).toBe("build the project");
  });

  it("flags an unknown command but keeps the text recoverable", () => {
    const p = interpret("/frobnicate now");
    expect(p.interpretation.type).toBe("unknown-command");
    expect(p.interpretation.summary).toMatch(/Unknown command/);
    expect(p.prompt).toBe("/frobnicate now");
  });
});
