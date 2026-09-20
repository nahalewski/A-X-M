import { spawn, ChildProcess } from "node:child_process";
import { globalShortcut } from "electron";

/**
 * Brings the menu up over a running game on the controller's Guide button (the
 * Xbox button, or the PS button through Steam Input / DS4Windows), the way the PS
 * button opens the XMB in-game.
 *
 * A background window can't see the Gamepad API - Chromium only delivers gamepad
 * input to the focused page - so the press has to be caught at the OS level. A
 * small PowerShell-hosted C# loop polls XInputGetStateEx, the undocumented export
 * (ordinal 100) that, unlike the public XInputGetState, reports the Guide bit.
 * It prints a line per press; that's all the main process listens for.
 *
 * A keyboard shortcut is registered as a fallback for testing and for pads XInput
 * can't see.
 */

const GUIDE_POLLER = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class AxmXInput {
  [StructLayout(LayoutKind.Sequential)] public struct Gamepad { public ushort Buttons; public byte LT; public byte RT; public short LX; public short LY; public short RX; public short RY; }
  [StructLayout(LayoutKind.Sequential)] public struct State { public uint Packet; public Gamepad Pad; }
  [DllImport("xinput1_4.dll", EntryPoint = "#100")] static extern int GetStateEx(int index, out State state);
  public static void Run() {
    bool[] was = new bool[4];
    while (true) {
      for (int i = 0; i < 4; i++) {
        State s;
        bool ok = false;
        try { ok = GetStateEx(i, out s) == 0; } catch { s = new State(); }
        bool guide = ok && (s.Pad.Buttons & 0x0400) != 0;
        if (guide && !was[i]) { Console.Out.WriteLine("GUIDE"); Console.Out.Flush(); }
        was[i] = guide;
      }
      Thread.Sleep(45);
    }
  }
}
"@
[AxmXInput]::Run()
`;

export class OverlayHotkey {
  private proc: ChildProcess | null = null;
  private shortcut: string | null = null;

  constructor(private onGuide: () => void) {}

  start(shortcut: string): void {
    this.startPoller();
    this.setShortcut(shortcut);
  }

  private startPoller(): void {
    if (this.proc) return;
    try {
      this.proc = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", GUIDE_POLLER], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch (err) {
      console.error("[A-X-M] could not start the Guide button poller:", err);
      return;
    }
    let buffer = "";
    this.proc.stdout?.setEncoding("utf-8");
    this.proc.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line === "GUIDE") this.onGuide();
      }
    });
    this.proc.on("exit", () => {
      this.proc = null;
    });
  }

  setShortcut(shortcut: string): void {
    if (this.shortcut) {
      try {
        globalShortcut.unregister(this.shortcut);
      } catch {
        // wasn't registered
      }
      this.shortcut = null;
    }
    if (!shortcut) return;
    try {
      if (globalShortcut.register(shortcut, () => this.onGuide())) this.shortcut = shortcut;
    } catch (err) {
      console.error("[A-X-M] could not register overlay shortcut", shortcut, err);
    }
  }

  stop(): void {
    this.setShortcut("");
    this.proc?.kill();
    this.proc = null;
  }
}
