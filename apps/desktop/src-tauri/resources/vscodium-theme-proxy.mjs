import http from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const upstream = new URL(process.argv[2] ?? "");
const themeDirectory = process.argv[3];
if (upstream.protocol !== "http:" || upstream.hostname !== "127.0.0.1") {
  throw new Error("LAW VSCodium theme proxy requires a loopback HTTP upstream");
}
if (!themeDirectory) throw new Error("LAW VSCodium theme proxy requires its installed theme directory");

const themes = {
  graphite: ["LAW Graphite", "law-graphite-color-theme.json", "dark"],
  light: ["LAW Paper", "law-paper-color-theme.json", "light"],
  midnight: ["LAW Midnight", "law-midnight-color-theme.json", "dark"],
  "high-contrast": ["LAW High Contrast", "law-high-contrast-color-theme.json", "hcDark"],
  dracula: ["Dracula", "dracula-color-theme.json", "dark"],
  "one-dark-pro": ["One Dark Pro", "one-dark-pro-color-theme.json", "dark"],
  monokai: ["Monokai", "monokai-color-theme.json", "dark"],
  "solarized-dark": ["Solarized Dark", "solarized-dark-color-theme.json", "dark"],
  "solarized-light": ["Solarized Light", "solarized-light-color-theme.json", "light"],
  nord: ["Nord", "nord-color-theme.json", "dark"],
  "gruvbox-dark": ["Gruvbox Dark", "gruvbox-dark-color-theme.json", "dark"],
  "github-dark": ["GitHub Dark", "github-dark-color-theme.json", "dark"],
  "github-light": ["GitHub Light", "github-light-color-theme.json", "light"],
  "tokyo-night": ["Tokyo Night", "tokyo-night-color-theme.json", "dark"],
  "night-owl": ["Night Owl", "night-owl-color-theme.json", "dark"],
  "catppuccin-mocha": ["Catppuccin Mocha", "catppuccin-mocha-color-theme.json", "dark"],
  "synthwave-84": ["Synthwave 84", "synthwave-84-color-theme.json", "dark"],
  "atom-one-light": ["Atom One Light", "atom-one-light-color-theme.json", "light"],
};

function readTheme(fileName) {
  const theme = JSON.parse(readFileSync(join(themeDirectory, fileName), "utf8"));
  if (!theme.include) return theme;
  const parent = readTheme(theme.include.replace(/^\.\//, ""));
  return { ...parent, ...theme, colors: { ...(parent.colors ?? {}), ...(theme.colors ?? {}) } };
}

function injectTheme(html, themeId) {
  const [label, fileName, themeType] = themes[themeId] ?? themes.graphite;
  const editorTheme = readTheme(fileName);
  const configured = html.replace(/data-settings="([^"]+)"/, (match, encoded) => {
    const decoded = encoded.replaceAll("&quot;", '"').replaceAll("&amp;", "&");
    const configuration = JSON.parse(decoded);
    configuration.configurationDefaults = {
      ...(configuration.configurationDefaults ?? {}),
      "window.autoDetectColorScheme": false,
      "workbench.colorTheme": label,
    };
    configuration.initialColorTheme = { themeType, colors: editorTheme.colors ?? {} };
    const updated = JSON.stringify(configuration).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
    return `data-settings="${updated}"`;
  });
  const variables = Object.entries(editorTheme.colors ?? {})
    .filter(([, value]) => typeof value === "string")
    .map(([name, value]) => `--vscode-${name.replaceAll(".", "-")}:${value} !important;`)
    .join("");
  const bootstrapStyle = `<style id="law-vscodium-theme">.monaco-workbench{${variables}}</style>`;
  return configured.replace("</head>", `${bootstrapStyle}</head>`);
}

const server = http.createServer((request, response) => {
  const requested = new URL(request.url ?? "/", "http://127.0.0.1");
  const themeId = requested.searchParams.get("lawTheme") ?? "graphite";
  requested.searchParams.delete("lawTheme");
  const headers = { ...request.headers, host: upstream.host };
  const outgoing = http.request({
    hostname: upstream.hostname,
    port: upstream.port,
    method: request.method,
    path: `${requested.pathname}${requested.search}`,
    headers,
  }, (incoming) => {
    const isWorkbench = request.method === "GET"
      && requested.pathname === "/"
      && String(incoming.headers["content-type"] ?? "").includes("text/html");
    if (!isWorkbench) {
      response.writeHead(incoming.statusCode ?? 502, incoming.headers);
      incoming.pipe(response);
      return;
    }
    const chunks = [];
    incoming.on("data", (chunk) => chunks.push(chunk));
    incoming.on("end", () => {
      const body = Buffer.from(injectTheme(Buffer.concat(chunks).toString("utf8"), themeId));
      const responseHeaders = { ...incoming.headers, "content-length": String(body.length) };
      delete responseHeaders["transfer-encoding"];
      response.writeHead(incoming.statusCode ?? 200, responseHeaders);
      response.end(body);
    });
  });
  outgoing.on("error", (error) => {
    if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
    response.end(`LAW VSCodium proxy error: ${error.message}`);
  });
  request.pipe(outgoing);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("LAW VSCodium proxy did not bind TCP");
  process.stdout.write(`http://127.0.0.1:${address.port}/\n`);
});
