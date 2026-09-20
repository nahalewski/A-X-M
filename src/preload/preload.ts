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
  pickBackgroundImage: () => ipcRenderer.invoke("axm:pickBackgroundImage"),
  openBrowser: (url: string) => ipcRenderer.invoke("axm:openBrowser", url),
  openMedia: (filePath: string) => ipcRenderer.invoke("axm:openMedia", filePath),
  getSaves: () => ipcRenderer.invoke("axm:getSaves"),
  browseMedia: (kind: "photo" | "video", dirPath: string | null) =>
    ipcRenderer.invoke("axm:browseMedia", kind, dirPath),
  listBundledAvatars: () => ipcRenderer.invoke("axm:listBundledAvatars"),
  listPictures: () => ipcRenderer.invoke("axm:listPictures"),
  fetchGameIcons: () => ipcRenderer.invoke("axm:fetchGameIcons"),
  onGameIcon: (callback: (update: { gameId?: string; name?: string; url?: string; done?: boolean }) => void) => {
    ipcRenderer.on("axm:gameIcon", (_e, update) => callback(update));
  },
  saveProfile: (profile: { name: string; avatarUrl: string }) => ipcRenderer.invoke("axm:saveProfile", profile),
  cacheImage: (url: string, key: string) => ipcRenderer.invoke("axm:cacheImage", url, key),
  listArtChoices: (gameId: string) => ipcRenderer.invoke("axm:listArtChoices", gameId),
  setGameArt: (gameId: string, url: string) => ipcRenderer.invoke("axm:setGameArt", gameId, url),
  jellyfinDiscover: () => ipcRenderer.invoke("axm:jellyfinDiscover"),
  jellyfinLogin: (server: unknown, username: string, password: string) =>
    ipcRenderer.invoke("axm:jellyfinLogin", server, username, password),
  jellyfinForget: (serverUrl: string) => ipcRenderer.invoke("axm:jellyfinForget", serverUrl),
  jellyfinLibraries: (login: unknown) => ipcRenderer.invoke("axm:jellyfinLibraries", login),
  jellyfinItems: (login: unknown, parentId: string) => ipcRenderer.invoke("axm:jellyfinItems", login, parentId),
  getAnkerStatus: () => ipcRenderer.invoke("axm:getAnkerStatus"),
  getWifiStatus: () => ipcRenderer.invoke("axm:getWifiStatus"),
  getBluetoothStatus: () => ipcRenderer.invoke("axm:getBluetoothStatus"),
  getHardwareInfo: () => ipcRenderer.invoke("axm:getHardwareInfo"),
  getMediaDrives: () => ipcRenderer.invoke("axm:getMediaDrives"),
  getVolumes: () => ipcRenderer.invoke("axm:getVolumes"),
  getControllerDevices: () => ipcRenderer.invoke("axm:getControllerDevices"),
  wifiList: () => ipcRenderer.invoke("axm:wifiList"),
  wifiConnect: (ssid: string, password: string | null) => ipcRenderer.invoke("axm:wifiConnect", ssid, password),
  wifiDisconnect: () => ipcRenderer.invoke("axm:wifiDisconnect"),
  wifiForget: (ssid: string) => ipcRenderer.invoke("axm:wifiForget", ssid),
  btList: () => ipcRenderer.invoke("axm:btList"),
  btPair: (id: string) => ipcRenderer.invoke("axm:btPair", id),
  btUnpair: (id: string) => ipcRenderer.invoke("axm:btUnpair", id),
  createMediaFolder: (parentDir: string, name: string) => ipcRenderer.invoke("axm:createMediaFolder", parentDir, name),
  getSongInfo: (filePath: string) => ipcRenderer.invoke("axm:getSongInfo", filePath),
  getScreenInfo: (title: string, year: string, kind: string, tmdbId?: string) => ipcRenderer.invoke("axm:getScreenInfo", title, year, kind, tmdbId),
  copyMedia: (kind: string, source: string, target: string) => ipcRenderer.invoke("axm:copyMedia", kind, source, target),
  jellyfinDownload: (login: unknown, itemId: string, name: string, kind: string, target: string, container: string) =>
    ipcRenderer.invoke("axm:jellyfinDownload", login, itemId, name, kind, target, container),
  onTransfer: (callback: (progress: unknown) => void) => {
    ipcRenderer.on("axm:transfer", (_e, progress) => callback(progress));
  },
  onResolution: (callback: (state: unknown) => void) => {
    ipcRenderer.on("axm:resolution", (_e, state) => callback(state));
  },
  getResolution: () => ipcRenderer.invoke("axm:getResolution"),
  browserOpen: (url: string) => ipcRenderer.invoke("axm:browserOpen", url),
  browserClose: () => ipcRenderer.invoke("axm:browserClose"),
  browserInput: (action: string) => ipcRenderer.invoke("axm:browserInput", action),
  onBrowserClosed: (callback: () => void) => {
    ipcRenderer.on("axm:browserClosed", () => callback());
  },
  onBrowserNav: (callback: (state: unknown) => void) => {
    ipcRenderer.on("axm:browserNav", (_e, state) => callback(state));
  },
  overlayClose: () => ipcRenderer.invoke("axm:overlayClose"),
  overlayToggle: () => ipcRenderer.invoke("axm:overlayToggle"),
  overlayState: () => ipcRenderer.invoke("axm:overlayState"),
  onOverlay: (callback: (state: { active: boolean }) => void) => {
    ipcRenderer.on("axm:overlay", (_e, state) => callback(state));
  },
  getSteamLibrary: () => ipcRenderer.invoke("axm:getSteamLibrary"),
  installSteamGame: (appid: number) => ipcRenderer.invoke("axm:installSteamGame", appid),
  launchSteamApp: (appid: number) => ipcRenderer.invoke("axm:launchSteamApp", appid),
  openFolder: (dirPath: string) => ipcRenderer.invoke("axm:openFolder", dirPath),
  getLaunchers: () => ipcRenderer.invoke("axm:getLaunchers"),
  openLauncher: (id: string) => ipcRenderer.invoke("axm:openLauncher", id),
  onArtUpdated: (callback: (update: { gameId: string; iconPath?: string; heroPath?: string }) => void) => {
    ipcRenderer.on("axm:artUpdated", (_e, update) => callback(update));
  },
  quit: () => ipcRenderer.invoke("axm:quit"),
};

contextBridge.exposeInMainWorld("axm", api);

export type AxmApi = typeof api;
