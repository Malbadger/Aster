import { run, fail, pass, fileExists } from "./_lib.mjs";

let code = run("npx", ["vitest", "run", "--config", "vitest.desktop.config.ts", "--project", "desktop", "apps/desktop/src/App.test.tsx", "apps/desktop/src/components/WorkspaceShell.test.tsx"]);
if (code !== 0) fail("A11Y", `automated semantic/keyboard battery failed (exit ${code})`);
code = run("npx", ["vitest", "run", "--config", "vitest.desktop.config.ts", "--project", "ui", "packages/ui/src/tokens.test.ts"]);
if (code !== 0) fail("A11Y", `contrast token battery failed (exit ${code})`);
if (!fileExists("work/evidence/law-desktop/screenshots/packaged-smoke.png")) fail("A11Y", "packaged UI capture missing; run desktop:smoke:packaged");
pass("A11Y", "automated=axe+keyboard+contrast packaged-capture=present manual-screen-reader=HUMAN-D-001");
