import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { run, fail, pass, fileExists } from "./_lib.mjs";

const passArg = process.argv.indexOf("--pass");
const number = passArg >= 0 ? Number(process.argv[passArg + 1]) : 1;
if (!Number.isInteger(number) || number < 1) fail("UAT", "--pass must be a positive integer");
const manifestPath = "work/evidence/law-desktop/package-manifest.json";
if (!fileExists(manifestPath)) fail("UAT", "package manifest missing");
const before = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
const commands = [
  ["npm", ["run", "check:all"]],
  ["npm", ["run", "desktop:test"]],
  ["npm", ["run", "desktop:smoke:packaged"]],
  ["npm", ["run", "desktop:exemplars"]],
  ["npm", ["run", "desktop:a11y"]],
  ["npm", ["run", "release:audit"]],
];
for (const [command, args] of commands) {
  const code = run(command, args);
  if (code !== 0) fail("UAT", `${command} ${args.join(" ")} failed (exit ${code})`);
}
const after = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
if (before !== after) fail("UAT", "package manifest changed during acceptance pass");
mkdirSync("work/evidence/law-desktop/uat", { recursive: true });
writeFileSync(`work/evidence/law-desktop/uat/pass-${number}.json`, JSON.stringify({ pass: number, at: new Date().toISOString(), packageManifestSha256: before, commands: commands.map(([c, a]) => `${c} ${a.join(" ")}`), result: "pass", humanGates: ["HUMAN-D-001", "HUMAN-D-002", "HUMAN-D-003", "HUMAN-D-004"] }, null, 2));
pass("UAT", `pass=${number} automated executable rows; human-only gates remain explicit`);
