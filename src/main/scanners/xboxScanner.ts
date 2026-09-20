import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { GameEntry } from "../types";

interface UwpRaw {
  Name: string;
  DisplayName: string;
  PackageFamilyName: string;
  AppId: string;
  InstallLocation: string;
  LogoRelative?: string;
}

// Known non-game system/utility apps to exclude from the game grid.
const BLOCKLIST = [
  "Microsoft.WindowsCalculator",
  "Microsoft.WindowsCamera",
  "Microsoft.Windows.Photos",
  "Microsoft.WindowsMaps",
  "Microsoft.WindowsSoundRecorder",
  "Microsoft.People",
  "Microsoft.WindowsCommunicationsApps", // Mail & Calendar
  "Microsoft.MicrosoftStickyNotes",
  "Microsoft.ScreenSketch",
  "Microsoft.MSPaint",
  "Microsoft.Paint",
  "Microsoft.GamingApp", // Xbox app itself
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
  "Microsoft.549981C3F5F10", // Cortana
  "Microsoft.Getstarted",
  "Microsoft.YourPhone",
  "Microsoft.ZuneMusic",
  "Microsoft.ZuneVideo",
  "microsoft.windowscommunicationsapps",
];

const PS_SCRIPT = `
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

function resolveLogo(installLocation: string, logoRelative?: string): string | undefined {
  if (!logoRelative) return undefined;
  const dir = path.dirname(logoRelative);
  const base = path.basename(logoRelative, path.extname(logoRelative));
  const ext = path.extname(logoRelative);
  const candidates = [
    logoRelative,
    path.join(dir, `${base}.scale-200${ext}`),
    path.join(dir, `${base}.scale-100${ext}`),
    path.join(dir, `${base}.targetsize-256${ext}`),
  ];
  for (const c of candidates) {
    const full = path.join(installLocation, c);
    // Must be a file:// URL - a raw Windows path in an <img src> resolves relative
    // to the renderer's own file:// document and silently fails to load.
    if (fs.existsSync(full)) return pathToFileURL(full).href;
  }
  return undefined;
}

export function scanXboxGames(): GameEntry[] {
  let raw: UwpRaw[] = [];
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS_SCRIPT], {
      encoding: "utf-8",
      maxBuffer: 32 * 1024 * 1024,
    });
    const parsed = JSON.parse(out || "[]");
    raw = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }

  const games: GameEntry[] = [];
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
      hidden: false,
    });
  }
  return games;
}
