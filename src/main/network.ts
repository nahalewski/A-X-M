import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFile } from "node:child_process";

/**
 * Wi-Fi and Bluetooth from inside the menu, so a handheld never has to drop to
 * Windows' settings.
 *
 * Wi-Fi goes through netsh: list what's in range, connect (creating a WPA2 profile
 * with the passphrase the user typed on the on-screen keyboard, or an open one),
 * disconnect, forget.
 *
 * Bluetooth goes through WinRT from PowerShell: the paired list from PnP, and
 * pairing / unpairing through DeviceInformation.Pairing. Discovery of *new* devices
 * is best effort: FindAllAsync returns what Windows has already seen - a device in
 * pairing mode that Windows has noticed recently. A live scan needs a DeviceWatcher,
 * which PowerShell 5.1 can't drive (no WinRT event subscription), so if a device
 * doesn't appear, the row says to put it in pairing mode and scan again.
 */

export interface WifiNetwork {
  ssid: string;
  signal: number;
  auth: string;
  connected: boolean;
  /** A saved profile exists, so it can connect without a password. */
  known: boolean;
}

export interface BluetoothDevice {
  id: string;
  name: string;
  paired: boolean;
  connected: boolean;
  canPair: boolean;
  kind: "audio" | "controller" | "input" | "other";
}

function run(cmd: string, args: string[], timeout = 20_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: "utf-8", timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (stdout ?? "") + (stderr ?? "") });
    });
  });
}

const ps = (script: string, timeout = 40_000) => run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], timeout);

// ---- Wi-Fi ----------------------------------------------------------------------

export async function listWifi(): Promise<WifiNetwork[]> {
  const [nets, iface, profiles] = await Promise.all([
    run("netsh", ["wlan", "show", "networks", "mode=bssid"]),
    run("netsh", ["wlan", "show", "interfaces"]),
    run("netsh", ["wlan", "show", "profiles"]),
  ]);
  const current = (iface.out.match(/^\s*SSID\s*:\s*(.+)$/m)?.[1] ?? "").trim();
  const state = (iface.out.match(/^\s*State\s*:\s*(.+)$/m)?.[1] ?? "").trim().toLowerCase();
  const known = new Set(
    [...profiles.out.matchAll(/All User Profile\s*:\s*(.+)$/gm)].map((m) => m[1].trim())
  );
  const out = new Map<string, WifiNetwork>();
  const blocks = nets.out.split(/\r?\n(?=SSID \d+ :)/);
  for (const block of blocks) {
    const ssid = (block.match(/^SSID \d+ :\s*(.*)$/m)?.[1] ?? "").trim();
    if (!ssid) continue;
    const auth = (block.match(/Authentication\s*:\s*(.+)$/m)?.[1] ?? "").trim();
    const signals = [...block.matchAll(/Signal\s*:\s*(\d+)%/g)].map((m) => Number(m[1]));
    const signal = signals.length ? Math.max(...signals) : 0;
    const existing = out.get(ssid);
    if (!existing || existing.signal < signal) {
      out.set(ssid, { ssid, signal, auth, connected: state === "connected" && current === ssid, known: known.has(ssid) });
    }
  }
  return [...out.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || b.signal - a.signal);
}

function profileXml(ssid: string, password: string | null): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const hex = Buffer.from(ssid, "utf-8").toString("hex").toUpperCase();
  const security = password
    ? `<security><authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption>
      <sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>${esc(password)}</keyMaterial></sharedKey></security>`
    : `<security><authEncryption><authentication>open</authentication><encryption>none</encryption><useOneX>false</useOneX></authEncryption></security>`;
  return `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
  <name>${esc(ssid)}</name>
  <SSIDConfig><SSID><hex>${hex}</hex><name>${esc(ssid)}</name></SSID></SSIDConfig>
  <connectionType>ESS</connectionType>
  <connectionMode>auto</connectionMode>
  <MSM>${security}</MSM>
</WLANProfile>`;
}

/** Connects; `password` is only needed for a network without a saved profile. */
export async function connectWifi(ssid: string, password: string | null): Promise<{ ok: boolean; message: string }> {
  if (password !== null) {
    const file = path.join(os.tmpdir(), `axm-wlan-${Date.now()}.xml`);
    fs.writeFileSync(file, profileXml(ssid, password || null), "utf-8");
    const add = await run("netsh", ["wlan", "add", "profile", `filename=${file}`, "user=current"]);
    try {
      fs.unlinkSync(file);
    } catch {
      // temp file; best effort
    }
    if (!add.ok && !/added/i.test(add.out)) return { ok: false, message: add.out.trim().split(/\r?\n/).pop() ?? "Couldn't save the network" };
  }
  const res = await run("netsh", ["wlan", "connect", `name=${ssid}`]);
  const ok = /completed successfully/i.test(res.out);
  if (!ok) return { ok, message: res.out.trim().split(/\r?\n/).filter(Boolean).pop() ?? "Couldn't connect" };
  // netsh returns before the link is up; give it a moment and report what happened.
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const iface = await run("netsh", ["wlan", "show", "interfaces"]);
    const state = (iface.out.match(/^\s*State\s*:\s*(.+)$/m)?.[1] ?? "").trim().toLowerCase();
    const current = (iface.out.match(/^\s*SSID\s*:\s*(.+)$/m)?.[1] ?? "").trim();
    if (state === "connected" && current === ssid) return { ok: true, message: `Connected to ${ssid}` };
    if (state === "disconnected" && i > 4) break;
  }
  return { ok: false, message: `Couldn't join ${ssid} - check the password` };
}

export async function disconnectWifi(): Promise<void> {
  await run("netsh", ["wlan", "disconnect"]);
}

export async function forgetWifi(ssid: string): Promise<void> {
  await run("netsh", ["wlan", "delete", "profile", `name=${ssid}`]);
}

// ---- Bluetooth --------------------------------------------------------------------

const WINRT_PRELUDE = `
$ErrorActionPreference = 'SilentlyContinue'
[Windows.Devices.Enumeration.DeviceInformation,Windows.Devices.Enumeration,ContentType=WindowsRuntime] | Out-Null
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$BT = 'System.Devices.Aep.ProtocolId:="{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}"'
$BLE = 'System.Devices.Aep.ProtocolId:="{bb7bb05e-5972-42b5-94fc-76eaa7084d49}"'
$props = [string[]]@('System.Devices.Aep.IsConnected','System.Devices.Aep.IsPaired','System.Devices.Aep.Bluetooth.Le.IsConnectable')
function Find($aqs) { Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($aqs, $props, [Windows.Devices.Enumeration.DeviceInformationKind]::AssociationEndpoint)) ([Windows.Devices.Enumeration.DeviceInformationCollection]) }
`;

function kindOf(name: string): BluetoothDevice["kind"] {
  if (/controller|dualsense|dualshock|gamepad|joy-con|pro controller|xbox/i.test(name)) return "controller";
  if (/headphone|headset|buds|speaker|audio|airpods|soundcore|wh-|wf-/i.test(name)) return "audio";
  if (/keyboard|mouse|trackpad/i.test(name)) return "input";
  return "other";
}

export async function listBluetooth(): Promise<BluetoothDevice[]> {
  const script = `${WINRT_PRELUDE}
$all = @(Find $BT) + @(Find $BLE)
$out = foreach ($d in $all) {
  if (-not $d.Name) { continue }
  [PSCustomObject]@{ Id = $d.Id; Name = $d.Name; Paired = [bool]$d.Pairing.IsPaired; CanPair = [bool]$d.Pairing.CanPair; Connected = [bool]$d.Properties['System.Devices.Aep.IsConnected'] }
}
@($out) | ConvertTo-Json -Compress`;
  const res = await ps(script);
  try {
    const raw = JSON.parse(res.out.trim() || "[]") as Record<string, unknown> | Record<string, unknown>[];
    const rows = Array.isArray(raw) ? raw : [raw];
    const seen = new Map<string, BluetoothDevice>();
    for (const r of rows) {
      const name = String(r.Name ?? "");
      if (!name) continue;
      const dev: BluetoothDevice = {
        id: String(r.Id),
        name,
        paired: !!r.Paired,
        connected: !!r.Connected,
        canPair: !!r.CanPair,
        kind: kindOf(name),
      };
      // The same device often shows on both Classic and LE; keep the paired/connected one.
      const prev = seen.get(name);
      if (!prev || (dev.paired && !prev.paired) || (dev.connected && !prev.connected)) seen.set(name, dev);
    }
    return [...seen.values()].sort((a, b) => Number(b.connected) - Number(a.connected) || Number(b.paired) - Number(a.paired) || a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** Pairs (Just Works / confirm-only); devices that need a PIN report as such. */
export async function pairBluetooth(id: string): Promise<{ ok: boolean; message: string }> {
  const script = `${WINRT_PRELUDE}
$d = Await ([Windows.Devices.Enumeration.DeviceInformation]::CreateFromIdAsync('${id.replace(/'/g, "''")}')) ([Windows.Devices.Enumeration.DeviceInformation])
if (-not $d) { 'NOTFOUND'; exit }
if ($d.Pairing.IsPaired) { 'ALREADY'; exit }
$r = Await ($d.Pairing.PairAsync()) ([Windows.Devices.Enumeration.DevicePairingResult])
$r.Status.ToString()`;
  const res = await ps(script, 60_000);
  const status = res.out.trim().split(/\r?\n/).pop() ?? "";
  const ok = status === "Paired" || status === "ALREADY" || status === "AlreadyPaired";
  const messages: Record<string, string> = {
    Paired: "Paired",
    ALREADY: "Already paired",
    NOTFOUND: "Device not found - put it in pairing mode and scan again",
    AuthenticationFailure: "Pairing was refused by the device",
    AuthenticationTimeout: "The device didn't answer in time",
    RequiredHandlerNotRegistered: "This device needs a PIN, which the menu can't enter yet",
    ConnectionRejected: "The device rejected the connection",
    Failed: "Pairing failed",
  };
  return { ok, message: messages[status] ?? (status ? `Pairing: ${status}` : "Pairing failed") };
}

export async function unpairBluetooth(id: string): Promise<{ ok: boolean; message: string }> {
  const script = `${WINRT_PRELUDE}
$d = Await ([Windows.Devices.Enumeration.DeviceInformation]::CreateFromIdAsync('${id.replace(/'/g, "''")}')) ([Windows.Devices.Enumeration.DeviceInformation])
if (-not $d) { 'NOTFOUND'; exit }
$r = Await ($d.Pairing.UnpairAsync()) ([Windows.Devices.Enumeration.DeviceUnpairingResult])
$r.Status.ToString()`;
  const res = await ps(script, 60_000);
  const status = res.out.trim().split(/\r?\n/).pop() ?? "";
  return { ok: status === "Unpaired" || status === "AlreadyUnpaired", message: status === "Unpaired" ? "Removed" : `Remove: ${status || "failed"}` };
}
