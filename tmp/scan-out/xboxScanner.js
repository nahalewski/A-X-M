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

// src/main/scanners/xboxScanner.ts
var xboxScanner_exports = {};
__export(xboxScanner_exports, {
  scanXboxGames: () => scanXboxGames
});
module.exports = __toCommonJS(xboxScanner_exports);
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));
var import_node_url = require("node:url");
var import_node_child_process = require("node:child_process");
var BLOCKLIST = [
  "Microsoft.WindowsCalculator",
  "Microsoft.WindowsCamera",
  "Microsoft.Windows.Photos",
  "Microsoft.WindowsMaps",
  "Microsoft.WindowsSoundRecorder",
  "Microsoft.People",
  "Microsoft.WindowsCommunicationsApps",
  // Mail & Calendar
  "Microsoft.MicrosoftStickyNotes",
  "Microsoft.ScreenSketch",
  "Microsoft.MSPaint",
  "Microsoft.Paint",
  "Microsoft.GamingApp",
  // Xbox app itself
  "Microsoft.XboxApp",
  "Microsoft.XboxIdentityProvider",
  "Microsoft.XboxGameOverlay",
  "Microsoft.XboxGamingOverlay",
  "Microsoft.XboxSpeechToTextOverlay",
  "Microsoft.Xbox.TCUI",
  "Microsoft.GamingServices",
  "Clipchamp.Clipchamp",
  "Microsoft.OutlookForWindows",
  "Microsoft.Todos",
  "Microsoft.WindowsStore",
  "Microsoft.WindowsTerminal",
  "Microsoft.WindowsNotepad",
  "MicrosoftCorporationII.MicrosoftFamily",
  "Microsoft.549981C3F5F10",
  // Cortana
  "Microsoft.Getstarted",
  "Microsoft.YourPhone",
  "Microsoft.ZuneMusic",
  "Microsoft.ZuneVideo",
  "microsoft.windowscommunicationsapps"
];
var PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Get-AppxPackage | Where-Object { $_.SignatureKind -eq 'Store' -and -not $_.IsFramework -and -not $_.IsResourcePackage } | ForEach-Object {
  $pkg = $_
  try {
    $manifest = Get-AppxPackageManifest -Package $pkg.PackageFullName
    $app = $manifest.Package.Applications.Application | Select-Object -First 1
    if (-not $app) { return }
    $visual = $app.VisualElements
    $displayName = $visual.DisplayName
    if ($displayName -match '^ms-resource:') { $displayName = $pkg.Name }
    $logo = $visual.Square150x150Logo
    if (-not $logo) { $logo = $visual.Square44x44Logo }
    [PSCustomObject]@{
      Name = $pkg.Name
      DisplayName = $displayName
      PackageFamilyName = $pkg.PackageFamilyName
      AppId = $app.Id
      InstallLocation = $pkg.InstallLocation
      LogoRelative = $logo
    }
  } catch {}
} | ConvertTo-Json -Compress -Depth 4
`;
function resolveLogo(installLocation, logoRelative) {
  if (!logoRelative) return void 0;
  const dir = path.dirname(logoRelative);
  const base = path.basename(logoRelative, path.extname(logoRelative));
  const ext = path.extname(logoRelative);
  const candidates = [
    logoRelative,
    path.join(dir, `${base}.scale-200${ext}`),
    path.join(dir, `${base}.scale-100${ext}`),
    path.join(dir, `${base}.targetsize-256${ext}`)
  ];
  for (const c of candidates) {
    const full = path.join(installLocation, c);
    if (fs.existsSync(full)) return (0, import_node_url.pathToFileURL)(full).href;
  }
  return void 0;
}
function scanXboxGames() {
  let raw = [];
  try {
    const out = (0, import_node_child_process.execFileSync)("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS_SCRIPT], {
      encoding: "utf-8",
      maxBuffer: 32 * 1024 * 1024
    });
    const parsed = JSON.parse(out || "[]");
    raw = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
  const games = [];
  for (const item of raw) {
    if (!item || !item.PackageFamilyName || !item.AppId || !item.DisplayName) continue;
    if (BLOCKLIST.some((b) => item.Name?.toLowerCase().startsWith(b.toLowerCase()))) continue;
    games.push({
      id: `xbox-${item.PackageFamilyName}`,
      name: item.DisplayName,
      source: "xbox",
      launchType: "shell",
      launchTarget: `shell:AppsFolder\\${item.PackageFamilyName}!${item.AppId}`,
      installDir: item.InstallLocation,
      drive: (item.InstallLocation || "C:").slice(0, 2).toUpperCase(),
      iconPath: resolveLogo(item.InstallLocation, item.LogoRelative),
      losslessProfile: null,
      hidden: false
    });
  }
  return games;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  scanXboxGames
});
