import { execFile } from "node:child_process";
import * as os from "node:os";

/**
 * Wi-Fi and Bluetooth state for the status bar, and the hardware summary for the
 * HUD. Everything shells out to PowerShell asynchronously - nothing here may block
 * the main process (see ankerMonitor for why that matters).
 */

export interface WifiStatus {
  /** Adapter present at all. */
  present: boolean;
  connected: boolean;
  ssid: string | null;
  /** 0..100 as Windows reports it, or null when not connected. */
  signal: number | null;
}

export interface BluetoothStatus {
  present: boolean;
  enabled: boolean;
  /** Paired devices currently connected. */
  connectedCount: number;
}

export interface HardwareInfo {
  deviceName: string;
  /** Marketing name where it can be told apart (ROG Xbox Ally X, ROG Ally, ...). */
  model: string;
  cpu: string;
  cpuGhz: number;
  ramGb: number;
  gpu: string;
  gpuGb: number | null;
}

function run(script: string, timeout = 12_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { encoding: "utf-8", timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => resolve(err ? "" : stdout)
    );
  });
}

export async function getWifiStatus(): Promise<WifiStatus> {
  const out = await run("netsh wlan show interfaces");
  if (!out.trim() || /no wireless interface|not running/i.test(out)) {
    return { present: false, connected: false, ssid: null, signal: null };
  }
  const state = /^\s*State\s*:\s*(.+)$/im.exec(out)?.[1].trim().toLowerCase() ?? "";
  const ssid = /^\s*SSID\s*:\s*(.+)$/im.exec(out)?.[1].trim() ?? null;
  const signal = /^\s*Signal\s*:\s*(\d+)%/im.exec(out)?.[1];
  const connected = state === "connected";
  return { present: true, connected, ssid: connected ? ssid : null, signal: connected && signal ? Number(signal) : null };
}

const BT_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$radio = Get-PnpDevice -Class Bluetooth | Where-Object { $_.FriendlyName -match 'Adapter|Radio' } | Select-Object -First 1
$devs = Get-PnpDevice -Class Bluetooth,BluetoothLE -PresentOnly | Where-Object { $_.FriendlyName -notmatch 'Enumerator|Adapter|Radio|Service|Transport|Protocol|Generic|RFCOMM|Pan|Personal|Microsoft|Avrcp|Sink|iAP|Handsfree|Headset' }
$connected = 0
foreach ($d in $devs) { if ((Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName '{83DA6326-97A6-4088-9453-A1923F573B29} 15').Data) { $connected++ } }
[PSCustomObject]@{ Present = [bool]$radio; Enabled = ($radio -and $radio.Status -eq 'OK'); Connected = $connected } | ConvertTo-Json -Compress
`;

export async function getBluetoothStatus(): Promise<BluetoothStatus> {
  try {
    const j = JSON.parse((await run(BT_SCRIPT, 15_000)).trim() || "{}");
    return { present: !!j.Present, enabled: !!j.Enabled, connectedCount: Number(j.Connected ?? 0) };
  } catch {
    return { present: false, enabled: false, connectedCount: 0 };
  }
}

const HW_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$cs  = Get-CimInstance Win32_ComputerSystem
$gpu = Get-CimInstance Win32_VideoController | Sort-Object -Property AdapterRAM -Descending | Select-Object -First 1
# AdapterRAM is a 32-bit field; the registry holds the real size for big cards.
$vram = $null
foreach ($k in (Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}' | Where-Object { $_.PSChildName -match '^\\d{4}$' })) {
  $p = Get-ItemProperty $k.PSPath
  if ($p.DriverDesc -and $gpu -and $p.DriverDesc -eq $gpu.Name -and $p.'HardwareInformation.qwMemorySize') { $vram = [int64]$p.'HardwareInformation.qwMemorySize'; break }
}
if (-not $vram -and $gpu) { $vram = [int64]$gpu.AdapterRAM }
[PSCustomObject]@{
  Cpu = $cpu.Name; CpuMhz = $cpu.MaxClockSpeed
  RamBytes = [int64]$cs.TotalPhysicalMemory
  Manufacturer = $cs.Manufacturer; Model = $cs.Model; SystemFamily = $cs.SystemFamily; Name = $cs.Name
  Gpu = $gpu.Name; VramBytes = $vram
} | ConvertTo-Json -Compress
`;

let hardwareCache: HardwareInfo | null = null;

/** Static for the life of the process, so it's read once and remembered. */
export async function getHardwareInfo(): Promise<HardwareInfo> {
  if (hardwareCache) return hardwareCache;
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse((await run(HW_SCRIPT, 20_000)).trim() || "{}");
  } catch {
    // fall through to the os module values below
  }
  const model = String(j.Model ?? "").trim();
  const family = String(j.SystemFamily ?? "").trim();
  const cpuName = String(j.Cpu ?? os.cpus()[0]?.model ?? "Unknown CPU").replace(/\s+/g, " ").trim();
  const mhz = Number(j.CpuMhz ?? os.cpus()[0]?.speed ?? 0);
  const ramBytes = Number(j.RamBytes ?? os.totalmem());
  const vram = Number(j.VramBytes ?? 0);

  hardwareCache = {
    deviceName: String(j.Name ?? os.hostname()),
    model: friendlyModel(model, family),
    cpu: cpuName,
    cpuGhz: Math.round((mhz / 1000) * 10) / 10,
    ramGb: Math.round(ramBytes / 1024 ** 3),
    gpu: String(j.Gpu ?? "Unknown GPU"),
    gpuGb: vram > 0 ? Math.round((vram / 1024 ** 3) * 10) / 10 : null,
  };
  return hardwareCache;
}

/**
 * ASUS reports the Ally family through the SMBIOS model string (e.g. "RC71L",
 * "RC72LA", "RC73XA"). Map the ones we know to their shelf names and pass the
 * rest through as-is so nothing is ever mislabelled.
 */
function friendlyModel(model: string, family: string): string {
  const m = model.toUpperCase();
  if (/RC73X/.test(m)) return "ROG Xbox Ally X";
  if (/RC73Y/.test(m)) return "ROG Xbox Ally";
  if (/RC72L/.test(m)) return "ROG Ally X";
  if (/RC71L/.test(m)) return "ROG Ally";
  if (/ally/i.test(family) || /ally/i.test(model)) return model || family;
  // Desktop boards ship placeholder strings here rather than a real model.
  if (!model || /system product name|to be filled|default string|o\.e\.m/i.test(model)) return "";
  return model;
}


/** A game controller Windows knows about: battery for Bluetooth pads, and how it's linked. */
export interface ControllerDevice {
  name: string;
  kind: "ps" | "xbox" | "other";
  wireless: boolean;
  /** 0..100 for Bluetooth pads that report it; null otherwise. */
  battery: number | null;
}

export function getControllerDevices(): Promise<ControllerDevice[]> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$pads = Get-PnpDevice -PresentOnly | Where-Object { ($_.Class -in 'Bluetooth','BluetoothLE','HIDClass','XboxComposite','XnaComposite') -and ($_.FriendlyName -match 'controller|dualsense|dualshock|gamepad|xbox') -and ($_.FriendlyName -notmatch 'hub|receiver|enumerator|service') }
$out = foreach ($d in $pads) {
  $bat = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2').Data
  [PSCustomObject]@{ Name = $d.FriendlyName; Id = $d.InstanceId; Battery = $bat }
}
@($out) | ConvertTo-Json -Compress
`;
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf-8", timeout: 15_000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout.trim()) return resolve([]);
      try {
        const raw = JSON.parse(stdout) as { Name: string; Id: string; Battery: number | null } | { Name: string; Id: string; Battery: number | null }[];
        const rows = (Array.isArray(raw) ? raw : [raw]).filter((r) => r && r.Name);
        const seen = new Set<string>();
        const out: ControllerDevice[] = [];
        for (const r of rows) {
          const key = r.Name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          const id = (r.Id ?? "").toUpperCase();
          out.push({
            name: r.Name,
            kind: /dualsense|dualshock|wireless controller|sony/i.test(r.Name) ? "ps" : /xbox/i.test(r.Name) ? "xbox" : "other",
            wireless: id.startsWith("BTH"),
            battery: typeof r.Battery === "number" ? r.Battery : null,
          });
        }
        resolve(out);
      } catch {
        resolve([]);
      }
    });
  });
}