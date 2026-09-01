import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Desktop-side Vitest config. Runs the five desktop workspaces as projects with
 * the right environment each, and resolves `@law/contracts` / `@law/ui` from
 * SOURCE so tests never depend on a prior build step (the failure mode that bit
 * the first Ubuntu run). Invoked only via `--config`, so Aster Core's own runner
 * is unaffected.
 */
const alias = {
  "@law/contracts": fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)),
  "@law/ui": fileURLToPath(new URL("./packages/ui/src/index.ts", import.meta.url)),
};

const nodeProject = (name: string, root: string) => ({
  resolve: { alias },
  test: { name, root, environment: "node", include: ["src/**/*.test.ts"] },
});

export default defineConfig({
  test: {
    projects: [
      nodeProject("contracts", "packages/contracts"),
      nodeProject("ui", "packages/ui"),
      nodeProject("test-fixtures", "packages/test-fixtures"),
      nodeProject("lawd", "apps/lawd"),
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "desktop",
          root: "apps/desktop",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/test-setup.ts"],
          include: ["src/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
