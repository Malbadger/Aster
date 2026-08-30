import { describe, expect, it, vi } from "vitest";
import { GitService, parseStatus, type GitPort } from "./git-service.js";

function fakeGit(handler: (args: string[]) => { code: number; stdout: string; stderr: string }): GitPort {
  return { async run(args) { return handler(args); } };
}

describe("parseStatus", () => {
  it("parses branch, ahead/behind, and file states", () => {
    const s = parseStatus("## main...origin/main [ahead 2]\n M src/a.ts\n?? new.ts\nUU merge.ts");
    expect(s.branch).toBe("main");
    expect(s.ahead).toBe(2);
    expect(s.files).toContainEqual({ path: "new.ts", state: "untracked" });
    expect(s.files).toContainEqual({ path: "merge.ts", state: "conflicted" });
    expect(s.clean).toBe(false);
  });
});

describe("GitService remote guard (RULE-D-007)", () => {
  it("refuses a push without scoped confirmation and returns the exact scope needed", async () => {
    const svc = new GitService(fakeGit(() => ({ code: 0, stdout: "", stderr: "" })), "/repo");
    const res = await svc.remoteAction({ effect: "push", remote: "origin", branch: "main" });
    expect(res.performed).toBe(false);
    expect(res.requiredConfirmation).toEqual({ repository: "/repo", remote: "origin", branch: "main", effect: "push" });
  });

  it("refuses when confirmation scope does not match exactly", async () => {
    const svc = new GitService(fakeGit(() => ({ code: 0, stdout: "", stderr: "" })), "/repo");
    const res = await svc.remoteAction({ effect: "push", remote: "origin", branch: "main", confirmation: { repository: "/repo", remote: "origin", branch: "OTHER", effect: "push" } });
    expect(res.performed).toBe(false);
  });

  it("performs the push only with a matching confirmation", async () => {
    const run = vi.fn((args: string[]) => ({ code: 0, stdout: "", stderr: "" }));
    const svc = new GitService(fakeGit(run), "/repo");
    const res = await svc.remoteAction({ effect: "push", remote: "origin", branch: "main", confirmation: { repository: "/repo", remote: "origin", branch: "main", effect: "push" } });
    expect(res.performed).toBe(true);
    expect(run).toHaveBeenCalledWith(["push", "origin", "main"]);
  });

  it("uses --force-with-lease for a force push", async () => {
    const run = vi.fn((args: string[]) => ({ code: 0, stdout: "", stderr: "" }));
    const svc = new GitService(fakeGit(run), "/repo");
    await svc.remoteAction({ effect: "force-push", remote: "origin", branch: "main", confirmation: { repository: "/repo", remote: "origin", branch: "main", effect: "force-push" } });
    expect(run).toHaveBeenCalledWith(["push", "--force-with-lease", "origin", "main"]);
  });
});

describe("GitService local ops", () => {
  it("stages via argument arrays and commits", async () => {
    const calls: string[][] = [];
    const svc = new GitService(fakeGit((args) => {
      calls.push(args);
      if (args[0] === "rev-parse") return { code: 0, stdout: "abc123\n", stderr: "" };
      if (args[0] === "status") return { code: 0, stdout: "## main\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    }), "/repo");
    await svc.stage(["a.ts", "b.ts"]);
    const c = await svc.commit("msg");
    expect(c.commit).toBe("abc123");
    expect(calls).toContainEqual(["add", "--", "a.ts", "b.ts"]);
    expect(calls).toContainEqual(["commit", "-m", "msg"]);
  });
});
