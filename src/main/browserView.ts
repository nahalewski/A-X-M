import { BrowserWindow, WebContentsView } from "electron";

/**
 * A web page inside the menu window, for the Browser column, Jellyfin's web client,
 * Xbox Cloud Gaming and the like - rather than bouncing out to Edge.
 *
 * The view never takes keyboard focus on its own: the menu's renderer keeps the
 * gamepad, and forwards scroll / back / forward / close here over IPC, which are
 * replayed as input events into the page. Touch or mouse on the page works
 * directly, and Escape from inside the page closes it.
 */

const FOOTER_RESERVED = 58;
const SCROLL_STEP = 160;

export class InMenuBrowser {
  private view: WebContentsView | null = null;

  constructor(
    private getWindow: () => BrowserWindow | null,
    private onClosed: () => void,
    private onNav: (state: { url: string; title: string; canGoBack: boolean; canGoForward: boolean; loading: boolean }) => void
  ) {}

  private report(): void {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    this.onNav({
      url: wc.getURL(),
      title: wc.getTitle(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      loading: wc.isLoading(),
    });
  }

  isOpen(): boolean {
    return this.view !== null;
  }

  open(url: string): void {
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return;
    if (!this.view) {
      this.view = new WebContentsView({
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      win.contentView.addChildView(this.view);
      this.view.webContents.setAudioMuted(false);
      this.view.webContents.on("before-input-event", (_e, input) => {
        if (input.type === "keyDown" && input.key === "Escape") this.close();
      });
      // A page can't be allowed to spawn windows over the menu; open them in place.
      this.view.webContents.setWindowOpenHandler(({ url: target }) => {
        this.view?.webContents.loadURL(target);
        return { action: "deny" };
      });
      // Loads pull focus into the page; give it back so the controller keeps the menu.
      this.view.webContents.on("did-finish-load", () => this.getWindow()?.webContents.focus());
      // Keep the menu's toolbar honest about where the page is and what B/◀/▶ will do.
      for (const ev of ["did-start-loading", "did-stop-loading", "did-navigate", "did-navigate-in-page", "page-title-updated"] as const) {
        this.view.webContents.on(ev as "did-navigate", () => this.report());
      }
      win.on("resize", () => this.layout());
    }
    this.layout();
    void this.view.webContents.loadURL(url);
    // Hand focus straight back so the controller keeps driving the menu window.
    win.webContents.focus();
  }

  private layout(): void {
    const win = this.getWindow();
    if (!win || !this.view) return;
    const [w, h] = win.getContentSize();
    this.view.setBounds({ x: 0, y: 0, width: w, height: Math.max(100, h - FOOTER_RESERVED) });
  }

  /** Replays a menu action into the page. Returns false if there's nothing open. */
  input(action: string): boolean {
    if (!this.view) return false;
    const wc = this.view.webContents;
    const [w, h] = (this.getWindow()?.getContentSize() ?? [1280, 720]) as [number, number];
    const centre = { x: Math.round(w / 2), y: Math.round(h / 2) };
    switch (action) {
      case "up":
        wc.sendInputEvent({ type: "mouseWheel", ...centre, deltaX: 0, deltaY: SCROLL_STEP, canScroll: true });
        break;
      case "down":
        wc.sendInputEvent({ type: "mouseWheel", ...centre, deltaX: 0, deltaY: -SCROLL_STEP, canScroll: true });
        break;
      case "left":
        if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
        break;
      case "right":
        if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
        break;
      case "back":
        this.close();
        break;
      case "context":
        wc.reload();
        break;
    }
    return true;
  }

  close(): void {
    const win = this.getWindow();
    if (this.view) {
      if (win && !win.isDestroyed()) win.contentView.removeChildView(this.view);
      this.view.webContents.close();
      this.view = null;
    }
    this.onClosed();
    win?.webContents.focus();
  }
}
