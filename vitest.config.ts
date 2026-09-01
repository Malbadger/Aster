import { defineConfig, configDefaults } from "vitest/config";

/**
 * Root Vitest config for Aster Core (src/, tests/). The desktop workspaces have
 * their own config (`vitest.desktop.config.ts`) and are excluded here so Aster
 * Core's existing `vitest run` behaves exactly as before this monorepo change.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "apps/**", "packages/**"],
  },
});
