import { execFile } from "node:child_process";
import { loadSettings } from "./settingsStore";

/**
 * Reads the Anker power bank's charge through Windows' own Bluetooth stack. Once
 * the bank is paired in Windows, the OS reconnects to it whenever it's in range and
 * caches its reported battery level as a device property - so "connect
 * automatically in the background" is something Windows already does, and this
 * just asks it. No pairing prompt, no app of ours talking BLE directly.
 *
 * "Depleting" isn't something the standard battery service reports, so it's
 * inferred: the level fell since an earlier reading in the recent window.
 */

export interface AnkerStatus {
  /** Paired, present and currently connected. */
  connected: boolean;
  /** 0..100, or null if Windows has no reading. */
  level: number | null;
  /** Level has dropped within the recent window - the bank is supplying something. */
  depleting: boolean;
  deviceName: string | null;
}

// DEVPKEY_Bluetooth_Battery and DEVPKEY_Bluetooth_IsConnected.
const KEY_BATTERY = "{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2";
const KEY_CONNECTED = "{83DA6326-97A6-4088-9453-A1923F573B29} 15";

/** How long a drop in level counts as "still depleting" before it needs a fresh drop. */
const TREND_WINDOW_MS = 10 * 60 * 1000;

const history: { at: number; level: number }[] = [];

function script(namePattern: string): string {
  const escaped = namePattern.replace(/'/g, "''");
  return `
$ErrorActionPreference = 'SilentlyContinue'
$devs = Get-PnpDevice -Class Bluetooth,BluetoothLE -PresentOnly | Where-Object { $_.FriendlyName -match '${escaped}' }
$out = foreach ($d in $devs) {
  $bat = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName '${KEY_BATTERY}').Data
  $conn = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName '${KEY_CONNECTED}').Data
  [PSCustomObject]@{ Name = $d.FriendlyName; Battery = $bat; Connected = [bool]$conn }
}
@($out) | ConvertTo-Json -Compress
`;
}

/**
 * Runs the PowerShell query off the main thread. Get-PnpDevice can take several
 * seconds; doing it synchronously froze the whole main process - every IPC call
 * from the menu stalled behind it - on every poll.
 */
function queryDevices(pattern: string): Promise<{ Name: string; Battery: number | null; Connected: boolean }[]> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script(pattern)],
      { encoding: "utf-8", timeout: 15_000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve([]);
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve(Array.isArray(parsed) ? parsed : [parsed]);
        } catch {
          resolve([]);
        }
      }
    );
  });
}

let inFlight: Promise<AnkerStatus> | null = null;

export function readAnkerStatus(): Promise<AnkerStatus> {
  // Coalesce overlapping polls so a slow query never stacks PowerShell processes.
  if (inFlight) return inFlight;
  inFlight = readAnkerStatusUncached().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function readAnkerStatusUncached(): Promise<AnkerStatus> {
  const pattern = loadSettings().ankerDeviceName || "Anker";
  const rows = await queryDevices(pattern);

  // Prefer a connected device with a reading; fall back to any match so the name
  // still shows up while it's out of range.
  const best =
    rows.find((r) => r.Connected && r.Battery !== null && r.Battery !== undefined) ??
    rows.find((r) => r.Connected) ??
    rows[0];

  if (!best) return { connected: false, level: null, depleting: false, deviceName: null };

  const level = typeof best.Battery === "number" ? Math.max(0, Math.min(100, best.Battery)) : null;
  const now = Date.now();

  let depleting = false;
  if (best.Connected && level !== null) {
    history.push({ at: now, level });
    while (history.length > 0 && now - history[0].at > TREND_WINDOW_MS) history.shift();
    // Any earlier reading in the window that was higher means it's been draining.
    depleting = history.some((h) => h.level > level);
  } else {
    history.length = 0;
  }

  return { connected: best.Connected, level, depleting, deviceName: best.Name };
}
