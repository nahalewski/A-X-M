import { shell } from "electron";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { GameEntry } from "./types";
import { ensureLosslessScalingRunning } from "./losslessScaling";

export function launchGame(game: GameEntry): void {
  if (game.losslessProfile) {
    ensureLosslessScalingRunning();
  }

  switch (game.launchType) {
    case "uri":
      shell.openExternal(game.launchTarget);
      break;
    case "shell":
      // shell:AppsFolder\... must go through explorer.exe to resolve UWP activation.
      spawn("explorer.exe", [game.launchTarget], { detached: true, stdio: "ignore" }).unref();
      break;
    case "exe":
      spawn(game.launchTarget, game.launchArgs ?? [], {
        cwd: path.dirname(game.launchTarget),
        detached: true,
        stdio: "ignore",
      }).unref();
      break;
  }
}
