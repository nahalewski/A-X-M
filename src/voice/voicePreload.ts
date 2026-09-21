import { contextBridge, ipcRenderer } from "electron";

/** The only bridge the voice window has: transcripts out, nothing in. */
contextBridge.exposeInMainWorld("voice", {
  send: (event: string, payload: unknown) => ipcRenderer.send("axm:voice", { event, payload }),
});
