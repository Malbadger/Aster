import { describe, expect, it } from "vitest";
import { applyHunks, buildHunks, toContractHunk } from "./diff.js";

describe("editable diff (REQ-D-028)", () => {
  const oldText = "line1\nline2\nline3";
  const newText = "line1\nline2-changed\nline3\nline4";

  it("builds hunks for changed and added lines", () => {
    const hunks = buildHunks(oldText, newText);
    expect(hunks.length).toBeGreaterThanOrEqual(1);
    const contract = toContractHunk(hunks[0]!);
    expect(contract.lines.some((l) => l.startsWith("+"))).toBe(true);
  });

  it("rejecting all hunks reproduces the original", () => {
    const hunks = buildHunks(oldText, newText).map((h) => ({ ...h, status: "rejected" as const }));
    expect(applyHunks(oldText, hunks)).toBe(oldText);
  });

  it("accepting all hunks reproduces the new content", () => {
    const hunks = buildHunks(oldText, newText).map((h) => ({ ...h, status: "accepted" as const }));
    expect(applyHunks(oldText, hunks)).toBe(newText);
  });

  it("accepts hunks selectively", () => {
    const hunks = buildHunks("a\nb\nc", "a\nB\nc\nD");
    // Accept only the first hunk (b -> B), reject the rest.
    const decided = hunks.map((h, i) => ({ ...h, status: (i === 0 ? "accepted" : "rejected") as "accepted" | "rejected" }));
    const result = applyHunks("a\nb\nc", decided);
    expect(result).toContain("B");
    expect(result).not.toContain("D");
  });
});
