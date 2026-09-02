import { describe, expect, it } from "vitest";
import { EditorService, hashContent, type FsPort } from "./editor-service.js";

function memFs(init: Record<string, string> = {}): FsPort {
  const map = new Map(Object.entries(init));
  return {
    read: (p) => {
      const v = map.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    write: (p, c) => void map.set(p, c),
    exists: (p) => map.has(p),
    list: (p) => [...map.keys()].filter((key) => key.startsWith(`${p}/`) && !key.slice(p.length + 1).includes("/"))
      .map((key) => ({ name: key.slice(p.length + 1), kind: "file" as const })),
  };
}

const ROOT = "/work/ws";

describe("EditorService verification staleness (RULE-D-004)", () => {
  it("marks a verified file stale as soon as it is edited", () => {
    const fs = memFs({ [`${ROOT}/a.ts`]: "const x = (1)" });
    const svc = new EditorService({ workspaceRoot: ROOT, fs });
    svc.readFile("a.ts");
    const verified = svc.verifyRun("a.ts").state;
    expect(verified.verification).toBe("pass");

    // A human edit changes the hash → prior PASS is immediately stale.
    const edited = svc.writeFile("a.ts", "const x = (1) + broken(", "human").state;
    expect(edited.verification).toBe("stale");
    expect(edited.verifiedHash).not.toBe(edited.contentHash);

    // Re-verifying binds a new check to the new hash (which is now unbalanced → fail).
    const rerun = svc.verifyRun("a.ts");
    expect(rerun.run.result).toBe("fail");
    expect(rerun.state.verification).toBe("fail");
  });

  it("reports unverified before any check", () => {
    const fs = memFs({ [`${ROOT}/b.json`]: "{}" });
    const svc = new EditorService({ workspaceRoot: ROOT, fs });
    expect(svc.status("b.json").state.verification).toBe("unverified");
  });

  it("lists workspace children in directory-first natural order", () => {
    const fs: FsPort = {
      ...memFs({ [`${ROOT}/file10.ts`]: "", [`${ROOT}/file2.ts`]: "" }),
      exists: () => true,
      list: () => [
        { name: "file10.ts", kind: "file" },
        { name: "src", kind: "directory" },
        { name: "file2.ts", kind: "file" },
      ],
    };
    expect(new EditorService({ workspaceRoot: ROOT, fs }).listDirectory(ROOT).entries.map((entry) => entry.name))
      .toEqual(["src", "file2.ts", "file10.ts"]);
  });

  it("records mixed provenance when model and human both edit", () => {
    const fs = memFs({ [`${ROOT}/c.ts`]: "a" });
    const svc = new EditorService({ workspaceRoot: ROOT, fs });
    expect(svc.writeFile("c.ts", "b", "model").state.provenance).toBe("model");
    expect(svc.writeFile("c.ts", "c", "human").state.provenance).toBe("mixed");
  });

  it("blocks a path that escapes the workspace", () => {
    const svc = new EditorService({ workspaceRoot: ROOT, fs: memFs() });
    expect(() => svc.readFile("../../etc/passwd")).toThrow(/escapes the workspace/);
  });

  it("verifies JSON validity via the default checker", () => {
    const fs = memFs({ [`${ROOT}/d.json`]: '{"ok":true}' });
    const svc = new EditorService({ workspaceRoot: ROOT, fs });
    expect(svc.verifyRun("d.json").run.result).toBe("pass");
    svc.writeFile("d.json", "{ not json", "human");
    expect(svc.verifyRun("d.json").run.result).toBe("fail");
  });

  it("hashes content deterministically", () => {
    expect(hashContent("x")).toBe(hashContent("x"));
    expect(hashContent("x")).not.toBe(hashContent("y"));
  });
});
