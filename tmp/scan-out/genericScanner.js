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

// src/main/scanners/genericScanner.ts
var genericScanner_exports = {};
__export(genericScanner_exports, {
  scanGenericGames: () => scanGenericGames
});
module.exports = __toCommonJS(genericScanner_exports);
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var IGNORE_EXE_PATTERN = /(^unins|setup|redist|vcredist|dxsetup|crashhandler|crashpad|easyanticheat|battleye|eossdk|ue4prereq|directx|dotnet|vc_redist|helper|updater|launcher-service|cef|report|dump)/i;
var CANDIDATE_FOLDER_NAMES = ["Games", "Game", "GOG Games", "My Games"];
function listDrives() {
  const drives = [];
  for (let c = 65; c <= 90; c++) {
    const letter = String.fromCharCode(c);
    const root = `${letter}:\\`;
    if (fs.existsSync(root)) drives.push(root);
  }
  return drives;
}
function findMainExe(dir, depth = 2) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const exeCandidates = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".exe")).filter((e) => !IGNORE_EXE_PATTERN.test(e.name)).map((e) => path.join(dir, e.name));
  if (exeCandidates.length > 0) {
    let best = exeCandidates[0];
    let bestSize = 0;
    for (const c of exeCandidates) {
      try {
        const size = fs.statSync(c).size;
        if (size > bestSize) {
          bestSize = size;
          best = c;
        }
      } catch {
      }
    }
    return best;
  }
  if (depth > 0) {
    const subdirs = entries.filter((e) => e.isDirectory());
    for (const sub of subdirs) {
      const found = findMainExe(path.join(dir, sub.name), depth - 1);
      if (found) return found;
    }
  }
  return null;
}
function scanRoot(rootDir, drive) {
  let subdirs;
  try {
    subdirs = fs.readdirSync(rootDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  } catch {
    return [];
  }
  const games = [];
  for (const sub of subdirs) {
    const installDir = path.join(rootDir, sub.name);
    const exe = findMainExe(installDir, 2);
    if (!exe) continue;
    games.push({
      id: `generic-${Buffer.from(exe).toString("base64url")}`,
      name: sub.name,
      source: "generic",
      launchType: "exe",
      launchTarget: exe,
      installDir,
      drive,
      losslessProfile: null,
      hidden: false
    });
  }
  return games;
}
function scanGenericGames(extraFolders) {
  const games = [];
  const seen = /* @__PURE__ */ new Set();
  const roots = [...extraFolders];
  for (const drive of listDrives()) {
    for (const name of CANDIDATE_FOLDER_NAMES) {
      roots.push(path.join(drive, name));
    }
  }
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const drive = root.slice(0, 2).toUpperCase();
    for (const g of scanRoot(root, drive)) {
      if (seen.has(g.installDir)) continue;
      seen.add(g.installDir);
      games.push(g);
    }
  }
  return games;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  scanGenericGames
});
