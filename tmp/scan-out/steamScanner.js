"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main/scanners/steamScanner.ts
var steamScanner_exports = {};
__export(steamScanner_exports, {
  scanSteamGames: () => scanSteamGames
});
module.exports = __toCommonJS(steamScanner_exports);
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var import_node_child_process = require("node:child_process");

// src/main/vdf.ts
function parseVdf(text) {
  let i = 0;
  const n = text.length;
  function skipWhitespaceAndComments() {
    for (; ; ) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text[i] === "/" && text[i + 1] === "/") {
        while (i < n && text[i] !== "\n") i++;
        continue;
      }
      break;
    }
  }
  function readString() {
    skipWhitespaceAndComments();
    if (text[i] !== '"') throw new Error(`VDF parse error at ${i}: expected quote`);
    i++;
    let out = "";
    while (i < n && text[i] !== '"') {
      if (text[i] === "\\" && i + 1 < n) {
        out += text[i + 1];
        i += 2;
      } else {
        out += text[i];
        i++;
      }
    }
    i++;
    return out;
  }
  function readObject() {
    const obj = {};
    for (; ; ) {
      skipWhitespaceAndComments();
      if (i >= n || text[i] === "}") {
        i++;
        return obj;
      }
      const key = readString();
      skipWhitespaceAndComments();
      if (text[i] === "{") {
        i++;
        obj[key] = readObject();
      } else {
        obj[key] = readString();
      }
    }
  }
  skipWhitespaceAndComments();
  const rootKey = readString();
  skipWhitespaceAndComments();
  if (text[i] !== "{") throw new Error("VDF parse error: expected root object");
  i++;
  const root = {};
  root[rootKey] = readObject();
  return root;
}

// src/main/scanners/steamScanner.ts
function getSteamInstallPath() {
  try {
    const out = (0, import_node_child_process.execFileSync)(
      "reg",
      ["query", "HKCU\\Software\\Valve\\Steam", "/v", "SteamPath"],
      { encoding: "utf-8" }
    );
    const match = out.match(/SteamPath\s+REG_SZ\s+(.+)/i);
    if (match) return match[1].trim().replace(/\//g, "\\");
  } catch {
  }
  const fallback = "C:\\Program Files (x86)\\Steam";
  return fs.existsSync(fallback) ? fallback : null;
}
function normalizePath(p) {
  return p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}
function getLibraryFolders(steamPath) {
  const libs = [steamPath];
  const seen = /* @__PURE__ */ new Set([normalizePath(steamPath)]);
  const vdfPath = path.join(steamPath, "steamapps", "libraryfolders.vdf");
  try {
    const text = fs.readFileSync(vdfPath, "utf-8");
    const parsed = parseVdf(text);
    const root = parsed["libraryfolders"];
    for (const key of Object.keys(root)) {
      const entry = root[key];
      if (typeof entry === "object" && entry.path) {
        const p = entry.path.replace(/\\\\/g, "\\");
        if (seen.has(normalizePath(p))) continue;
        seen.add(normalizePath(p));
        libs.push(p);
      }
    }
  } catch {
  }
  return libs;
}
function scanSteamGames() {
  const steamPath = getSteamInstallPath();
  if (!steamPath) return [];
  const libraries = getLibraryFolders(steamPath);
  const games = [];
  const seenAppIds = /* @__PURE__ */ new Set();
  for (const lib of libraries) {
    const steamappsDir = path.join(lib, "steamapps");
    let files = [];
    try {
      files = fs.readdirSync(steamappsDir).filter((f) => /^appmanifest_\d+\.acf$/i.test(f));
    } catch {
      continue;
    }
    for (const file of files) {
      try {
        const text = fs.readFileSync(path.join(steamappsDir, file), "utf-8");
        const parsed = parseVdf(text);
        const app = parsed["AppState"];
        if (!app) continue;
        const appId = app["appid"];
        const name = app["name"];
        const installDirName = app["installdir"];
        if (!appId || !name || !installDirName) continue;
        if (seenAppIds.has(appId)) continue;
        seenAppIds.add(appId);
        if (/steamworks common redistributables|steam controller configs|steam linux runtime|dts audio|proton|steamvr|redistributable/i.test(
          name
        )) {
          continue;
        }
        const installDir = path.join(steamappsDir, "common", installDirName);
        games.push({
          id: `steam-${appId}`,
          name,
          source: "steam",
          launchType: "uri",
          launchTarget: `steam://rungameid/${appId}`,
          installDir,
          drive: lib.slice(0, 2).toUpperCase(),
          iconPath: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
          // Steam ships the same wide banner the store uses; the renderer falls back
          // to the wave if a given app doesn't have one.
          heroPath: `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
          losslessProfile: null,
          hidden: false
        });
      } catch {
      }
    }
  }
  return games;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  scanSteamGames
});
