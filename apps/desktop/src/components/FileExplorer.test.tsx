import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FileExplorer } from "./FileExplorer.js";

describe("FileExplorer", () => {
  it("loads folders lazily and opens files", async () => {
    const open = vi.fn();
    const list = vi.fn(async (path: string) => path === "/work"
      ? [{ name: "src", path: "/work/src", kind: "directory" as const }, { name: "README.md", path: "/work/README.md", kind: "file" as const }]
      : [{ name: "main.ts", path: "/work/src/main.ts", kind: "file" as const }]);
    render(<FileExplorer root="/work" listDirectory={list} onOpenFile={open} />);
    fireEvent.click(await screen.findByRole("button", { name: /README\.md/ }));
    expect(open).toHaveBeenCalledWith("/work/README.md");
    fireEvent.click(screen.getByRole("button", { name: /src/ }));
    await waitFor(() => expect(list).toHaveBeenCalledWith("/work/src"));
    fireEvent.click(await screen.findByRole("button", { name: /main\.ts/ }));
    expect(open).toHaveBeenCalledWith("/work/src/main.ts");
  });
});
