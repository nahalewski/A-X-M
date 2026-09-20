import { contextBridge, ipcRenderer } from "electron";

const api = {
  getSettings: () => ipcRenderer.invoke("axm:getSettings"),
  setSettings: (partial: Record<string, unknown>) => ipcRenderer.invoke("axm:setSettings", partial),
  toggleFullscreen: () => ipcRenderer.invoke("axm:toggleFullscreen"),
  getGames: () => ipcRenderer.invoke("axm:getGames"),
  scanGames: () => ipcRenderer.invoke("axm:scanGames"),
  launchGame: (gameId: string) => ipcRenderer.invoke("axm:launchGame", gameId),
  setLosslessProfile: (gameId: string, profile: 1 | 2 | 3 | null) =>
    ipcRenderer.invoke("axm:setLosslessProfile", gameId, profile),
  losslessScalingStatus: () => ipcRenderer.invoke("axm:losslessScalingStatus"),
  pickGameFolder: () => ipcRenderer.invoke("axm:pickGameFolder"),
  getMedia: (kind: "photo" | "video" | "music") => ipcRenderer.invoke("axm:getMedia", kind),
  browseMusic: (dirPath: string | null) => ipcRenderer.invoke("axm:browseMusic", dirPath),
  pickMusicFolder: () => ipcRenderer.invoke("axm:pickMusicFolder"),
  openBrowser: (url: string) => ipcRenderer.invoke("axm:openBrowser", url),
  openMedia: (filePath: string) => ipcRenderer.invoke("axm:openMedia", filePath),
  onArtUpdated: (callback: (update: { gameId: string; iconPath?: string; heroPath?: string }) => void) => {
    ipcRenderer.on("axm:artUpdated", (_e, update) => callback(update));
  },
  quit: () => ipcRenderer.invoke("axm:quit"),
};

contextBridge.exposeInMainWorld("axm", api);

export type AxmApi = typeof api;
