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
  openMedia: (filePath: string) => ipcRenderer.invoke("axm:openMedia", filePath),
  quit: () => ipcRenderer.invoke("axm:quit"),
};

contextBridge.exposeInMainWorld("axm", api);

export type AxmApi = typeof api;
