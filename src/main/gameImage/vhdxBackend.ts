import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CreateImageOptions, GameImageBackend, GameImageError, GameImageStats, MountOptions } from "./backend";

/**
 * The Windows Game Image backend: a dynamically expanding VHDX.
 *
 * Every shell call the feature makes lives in this file. Two tools are used, both
 * present on every Windows edition:
 *
 * - diskpart      creates, attaches and detaches the image. Deliberately not
 *                 New-VHD / Mount-VHD, which come from the Hyper-V module and are
 *                 missing on Home editions.
 * - Get-DiskImage from the Storage module, for size, attach state and drive letter.
 *                 Read-only, and needs no elevation.
 *
 * Attaching a VHDX requires administrator rights on Windows. That is the OS's rule,
 * not ours, so rather than elevating behind the user's back an access-denied failure
 * is turned into a message that says exactly that.
 */

const MB = 1024 * 1024;

interface RunResult {
  code: number;
  out: string;
  err: string;
}

function run(command: string, args: string[], timeoutMs = 120_000): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on("data", (d) => (out += String(d)));
    child.stderr?.on("data", (d) => (err += String(d)));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: String(e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out, err });
    });
  });
}

/** diskpart reads a script file, never stdin, so each batch goes through a temp file. */
async function diskpart(script: string): Promise<RunResult> {
  const file = path.join(os.tmpdir(), `axm-diskpart-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  await fs.promises.writeFile(file, script.trim() + "\r\n", "utf-8");
  try {
    return await run("diskpart.exe", ["/s", file]);
  } finally {
    await fs.promises.unlink(file).catch(() => {});
  }
}

function powershell(script: string, timeoutMs = 60_000): Promise<RunResult> {
  return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], timeoutMs);
}

/** diskpart reports failure in its output at least as often as in its exit code. */
function diskpartFailed(res: RunResult): string | null {
  if (res.code !== 0) return res.err.trim() || res.out.trim() || `diskpart exited ${res.code}`;
  const encountered = /DiskPart has encountered an error:[^\r\n]*/i.exec(res.out);
  if (encountered) return encountered[0].trim();
  if (/access is denied/i.test(res.out)) return "Access is denied";
  return null;
}

function toGameImageError(what: string, detail: string): GameImageError {
  if (/access is denied|requires elevation|administrator/i.test(detail)) {
    return new GameImageError(
      `${what} needs administrator rights. Windows only lets an elevated process attach a Game Image, so A-X-M has to be run as administrator for this.`
    );
  }
  return new GameImageError(`${what}: ${detail}`);
}

interface DiskImageQuery {
  attached: boolean;
  sizeBytes: number;
  driveLetter: string | null;
  freeBytes: number | null;
}

export class WindowsVhdxBackend implements GameImageBackend {
  readonly id = "vhdx";
  readonly extension = ".vhdx";

  async isAvailable(): Promise<boolean> {
    if (process.platform !== "win32") return false;
    const res = await powershell("if (Get-Command Get-DiskImage -ErrorAction SilentlyContinue) { 'yes' }", 20_000);
    return res.out.includes("yes");
  }

  /**
   * Asks Windows everything we need about one image in a single call: whether it is
   * attached, how large it may grow, and while attached which drive letter it landed
   * on and how much room is left inside it.
   */
  private async query(imagePath: string): Promise<DiskImageQuery> {
    const escaped = imagePath.replace(/'/g, "''");
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      `$img = Get-DiskImage -ImagePath '${escaped}'`,
      "if (-not $img) { '{}'; exit }",
      "$letter = $null; $free = $null",
      "if ($img.Attached) {",
      "  $disk = $img | Get-Disk",
      "  if ($disk) {",
      "    $vol = $disk | Get-Partition | Get-Volume | Where-Object { $_.DriveLetter } | Select-Object -First 1",
      "    if ($vol) { $letter = $vol.DriveLetter; $free = $vol.SizeRemaining }",
      "  }",
      "}",
      "[pscustomobject]@{ attached = [bool]$img.Attached; size = [int64]$img.Size; letter = $letter; free = $free } | ConvertTo-Json -Compress",
    ].join("\n");

    const res = await powershell(script, 45_000);
    try {
      const parsed = JSON.parse(res.out.trim() || "{}") as {
        attached?: boolean;
        size?: number;
        letter?: string | null;
        free?: number | null;
      };
      return {
        attached: !!parsed.attached,
        sizeBytes: Number(parsed.size ?? 0),
        driveLetter: parsed.letter ? `${parsed.letter}:` : null,
        freeBytes: parsed.free == null ? null : Number(parsed.free),
      };
    } catch {
      return { attached: false, sizeBytes: 0, driveLetter: null, freeBytes: null };
    }
  }

  async create(options: CreateImageOptions): Promise<void> {
    if (fs.existsSync(options.path)) {
      throw new GameImageError(`There is already a Game Image at ${options.path}`);
    }
    await fs.promises.mkdir(path.dirname(options.path), { recursive: true });

    // diskpart works in whole megabytes and refuses anything under 3 MB.
    const maximumMb = Math.max(3, Math.floor(options.maxBytes / MB));
    // Volume labels are capped at 32 characters and cannot carry quotes.
    const label = options.label.replace(/["\r\n]/g, "").slice(0, 32) || "GAME IMAGE";

    const res = await diskpart(
      [
        `create vdisk file="${options.path}" maximum=${maximumMb} type=expandable`,
        `select vdisk file="${options.path}"`,
        "attach vdisk",
        "convert gpt",
        "create partition primary",
        `format fs=ntfs quick label="${label}"`,
        "assign",
        "detach vdisk",
      ].join("\n")
    );

    const failure = diskpartFailed(res);
    if (failure) {
      // A half-made image is worse than none: the next attempt would refuse to run
      // because the file already exists.
      await fs.promises.unlink(options.path).catch(() => {});
      throw toGameImageError("Creating the Game Image failed", failure);
    }
    if (!fs.existsSync(options.path)) {
      throw new GameImageError("Creating the Game Image reported success but produced no file");
    }
  }

  async mount(imagePath: string, options: MountOptions = {}): Promise<string> {
    if (!fs.existsSync(imagePath)) throw new GameImageError(`No Game Image at ${imagePath}`);

    const before = await this.query(imagePath);
    // Already mounted: hand back where it is rather than failing. Both crash
    // recovery and mount-before-launch rely on this being safe to repeat.
    if (before.attached && before.driveLetter) return before.driveLetter;

    if (!before.attached) {
      const res = await diskpart(
        [`select vdisk file="${imagePath}"`, `attach vdisk${options.readOnly ? " readonly" : ""}`].join("\n")
      );
      const failure = diskpartFailed(res);
      if (failure) throw toGameImageError("Mounting the Game Image failed", failure);
    }

    // Windows assigns the drive letter a moment after the attach call returns.
    for (let i = 0; i < 20; i++) {
      const now = await this.query(imagePath);
      if (now.attached && now.driveLetter) return now.driveLetter;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new GameImageError("The Game Image mounted but Windows gave it no drive letter");
  }

  async unmount(imagePath: string): Promise<void> {
    const before = await this.query(imagePath);
    if (!before.attached) return;

    const res = await diskpart([`select vdisk file="${imagePath}"`, "detach vdisk"].join("\n"));
    const failure = diskpartFailed(res);
    if (failure) throw toGameImageError("Unmounting the Game Image failed", failure);
  }

  async stats(imagePath: string): Promise<GameImageStats> {
    let allocatedBytes = 0;
    try {
      allocatedBytes = (await fs.promises.stat(imagePath)).size;
    } catch {
      throw new GameImageError(`No Game Image at ${imagePath}`);
    }
    const q = await this.query(imagePath);
    return {
      allocatedBytes,
      maxBytes: q.sizeBytes,
      freeBytes: q.freeBytes,
      mountPath: q.driveLetter,
      mounted: q.attached,
      readOnly: false,
    };
  }

  async expand(imagePath: string, maxBytes: number): Promise<void> {
    const q = await this.query(imagePath);
    if (q.attached) throw new GameImageError("Unmount the Game Image before expanding it");

    const targetMb = Math.floor(maxBytes / MB);
    if (targetMb * MB <= q.sizeBytes) {
      throw new GameImageError("A Game Image can only be made larger, never smaller");
    }
    const res = await diskpart(
      [`select vdisk file="${imagePath}"`, `expand vdisk maximum=${targetMb}`].join("\n")
    );
    const failure = diskpartFailed(res);
    if (failure) throw toGameImageError("Expanding the Game Image failed", failure);
  }

  async compact(imagePath: string): Promise<void> {
    const q = await this.query(imagePath);
    if (q.attached) throw new GameImageError("Unmount the Game Image before optimising it");

    const res = await diskpart(
      [`select vdisk file="${imagePath}"`, "attach vdisk readonly", "compact vdisk", "detach vdisk"].join("\n")
    );
    const failure = diskpartFailed(res);
    if (failure) throw toGameImageError("Optimising the Game Image failed", failure);
  }

  /**
   * Structural check of the container, not of the game inside it. Attaching
   * read-only and reading the volume back is the strongest check available without
   * a third-party tool, and read-only means it cannot alter anything.
   */
  async verify(imagePath: string): Promise<boolean> {
    if (!fs.existsSync(imagePath)) return false;

    const before = await this.query(imagePath);
    if (before.attached) return !!before.driveLetter;

    const res = await diskpart([`select vdisk file="${imagePath}"`, "attach vdisk readonly"].join("\n"));
    if (diskpartFailed(res)) {
      await this.unmount(imagePath).catch(() => {});
      return false;
    }

    let ok = false;
    for (let i = 0; i < 15; i++) {
      const q = await this.query(imagePath);
      if (q.attached && q.driveLetter) {
        ok = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    await this.unmount(imagePath).catch(() => {});
    return ok;
  }

  /**
   * Every VHDX Windows currently has attached. Used on startup to detach images a
   * previous run left behind, so a crash doesn't leave a game's files sitting open
   * as a stray drive letter.
   */
  async listMounted(): Promise<string[]> {
    const res = await powershell(
      [
        "$ErrorActionPreference='SilentlyContinue'",
        "Get-Disk | Where-Object { $_.Location -like '*.vhdx' -or $_.Location -like '*.vhd' } | ForEach-Object { $_.Location }",
      ].join("\n"),
      45_000
    );
    return res.out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }
}
