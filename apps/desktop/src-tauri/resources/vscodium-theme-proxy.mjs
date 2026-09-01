import http from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const upstream = new URL(process.argv[2] ?? "");
const themeDirectory = process.argv[3];
if (upstream.protocol !== "http:" || upstream.hostname !== "127.0.0.1") {
  throw new Error("Aster VSCodium theme proxy requires a loopback HTTP upstream");
}
if (!themeDirectory) throw new Error("Aster VSCodium theme proxy requires its installed theme directory");

const themes = {
  graphite: ["Aster Graphite", "law-graphite-color-theme.json", "dark"],
  light: ["Aster Paper", "law-paper-color-theme.json", "light"],
  midnight: ["Aster Midnight", "law-midnight-color-theme.json", "dark"],
  "high-contrast": ["Aster High Contrast", "law-high-contrast-color-theme.json", "hcDark"],
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
  const background = editorTheme.colors?.["editor.background"] ?? "#17161a";
  const foreground = editorTheme.colors?.["editor.foreground"] ?? "#ece9f0";
  const sidebar = editorTheme.colors?.["sideBar.background"] ?? background;
  const activity = editorTheme.colors?.["activityBar.background"] ?? sidebar;
  const tabs = editorTheme.colors?.["editorGroupHeader.tabsBackground"] ?? background;
  const panel = editorTheme.colors?.["panel.background"] ?? sidebar;
  const status = editorTheme.colors?.["statusBar.background"] ?? activity;
  const statusForeground = editorTheme.colors?.["statusBar.foreground"] ?? foreground;
  const border = editorTheme.colors?.["contrastBorder"] ?? editorTheme.colors?.["panel.border"] ?? "transparent";
  const bootstrapStyle = `<style id="law-vscodium-theme">
html,body,.monaco-workbench{background:${background}!important;color:${foreground}}
.monaco-workbench{${variables}}
.monaco-workbench .part.activitybar{background-color:${activity}!important}
.monaco-workbench .part.sidebar{background-color:${sidebar}!important;border-color:${border}!important}
.monaco-workbench .part.editor,.monaco-workbench .editor-group-container,.monaco-workbench .editor-group-container>.content,.monaco-workbench .monaco-editor,.monaco-workbench .monaco-editor-background,.monaco-workbench .monaco-editor .margin{background-color:${background}!important}
.monaco-workbench .tabs-and-actions-container,.monaco-workbench .editor-group-container>.title{background-color:${tabs}!important}
.monaco-workbench .part.panel{background-color:${panel}!important;border-color:${border}!important}
.monaco-workbench .part.statusbar,.monaco-workbench .part.statusbar .statusbar-item{background-color:${status}!important;color:${statusForeground}!important}
</style>`;
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
    response.end(`Aster VSCodium proxy error: ${error.message}`);
  });
  request.pipe(outgoing);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Aster VSCodium proxy did not bind TCP");
  process.stdout.write(`http://127.0.0.1:${address.port}/\n`);
});
