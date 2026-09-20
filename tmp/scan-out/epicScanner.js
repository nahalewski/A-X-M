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

// src/main/scanners/epicScanner.ts
var epicScanner_exports = {};
__export(epicScanner_exports, {
  scanEpicGames: () => scanEpicGames
});
module.exports = __toCommonJS(epicScanner_exports);
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var MANIFEST_DIR = "C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests";
function scanEpicGames() {
  let files = [];
  try {
    files = fs.readdirSync(MANIFEST_DIR).filter((f) => f.toLowerCase().endsWith(".item"));
  } catch {
    return [];
  }
  const games = [];
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(MANIFEST_DIR, file), "utf-8");
      const m = JSON.parse(raw);
      if (m.bIsIncompleteInstall) continue;
      if (!m.DisplayName || !m.InstallLocation || !m.CatalogNamespace || !m.CatalogItemId || !m.AppName) continue;
      games.push({
        id: `epic-${m.AppName}`,
        name: m.DisplayName,
        source: "epic",
        launchType: "uri",
        launchTarget: `com.epicgames.launcher://apps/${m.CatalogNamespace}%3A${m.CatalogItemId}%3A${m.AppName}?action=launch&silent=true`,
        installDir: m.InstallLocation,
        drive: m.InstallLocation.slice(0, 2).toUpperCase(),
        losslessProfile: null,
        hidden: false
      });
    } catch {
    }
  }
  return games;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  scanEpicGames
});
