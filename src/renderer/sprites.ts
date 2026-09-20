/**
 * Glyphs from the supplied browser / gallery / player sheets, each re-tiled into a
 * uniform 96px strip (assets/icons/*-sprite.webp) so a frame is just an index. They
 * are white-on-transparent and drawn as CSS masks, so they tint like every other
 * sprite in the menu.
 */

const SHEETS = {
  browser: ["back", "forward", "reload", "stop", "home", "search", "bookmark", "zoomin", "zoomout", "fullscreen", "address", "menu"],
  gallery: ["prev", "next", "play", "pause", "zoomin", "zoomout", "rotccw", "rotcw", "info", "grid", "image", "video", "expand", "collapse", "folder"],
  player: ["prev", "rew", "play", "pause", "stop", "next", "ff", "mute", "vollow", "volmid", "volhigh", "repeat", "shuffle", "list", "note", "eq", "headphones", "cplay", "cpause", "cstop", "cprev", "cnext"],
} as const;

export type SpriteSheet = keyof typeof SHEETS;

function style(sheet: SpriteSheet, name: string): string {
  const frames = SHEETS[sheet] as readonly string[];
  const index = Math.max(0, frames.indexOf(name));
  const url = `url("assets/icons/${sheet}-sprite.webp")`;
  const size = `${frames.length * 100}% 100%`;
  const pos = `${(index * 100) / (frames.length - 1)}% 0`;
  return `-webkit-mask-image:${url};mask-image:${url};-webkit-mask-size:${size};mask-size:${size};-webkit-mask-position:${pos};mask-position:${pos}`;
}

/** Inline HTML for a glyph, for footers and hint strips built with innerHTML. */
export function spriteHtml(sheet: SpriteSheet, name: string, extraClass = ""): string {
  return `<span class="spr ${extraClass}" style='${style(sheet, name)}'></span>`;
}

/** A glyph element whose frame can be swapped later (play <-> pause, say). */
export function spriteEl(sheet: SpriteSheet, name: string, extraClass = ""): HTMLElement & { setFrame: (name: string) => void } {
  const el = document.createElement("span") as HTMLElement & { setFrame: (name: string) => void };
  el.className = `spr ${extraClass}`.trim();
  el.setFrame = (frame: string) => {
    el.style.cssText = style(sheet, frame);
  };
  el.setFrame(name);
  return el;
}


/**
 * The progress ring from the supplied sheet, rebuilt as 17 clean frames: frame 0 has
 * no pod lit, frame 16 the full ring (the sheet had duplicates and gaps; every step
 * is composited from its darkest and lightest cells). Drawn as an image (its lit and unlit segments are part of
 * the art), positioned by background-position so a change of frame is one style.
 */
export const PROGRESS_FRAMES = 17;

export function progressRing(extraClass = ""): HTMLElement & { setProgress: (fraction: number) => void; spin: (on: boolean) => void } {
  const el = document.createElement("span") as HTMLElement & { setProgress: (fraction: number) => void; spin: (on: boolean) => void };
  el.className = `ring ${extraClass}`.trim();
  let timer = 0;
  let frame = 0;
  const show = (f: number) => {
    frame = Math.max(0, Math.min(PROGRESS_FRAMES - 1, Math.round(f)));
    el.style.backgroundPosition = `${(frame * 100) / (PROGRESS_FRAMES - 1)}% 0`;
  };
  el.setProgress = (fraction: number) => {
    el.spin(false);
    show(fraction * (PROGRESS_FRAMES - 1));
  };
  // Indeterminate: the ring keeps filling round, for "loading" with no known total.
  el.spin = (on: boolean) => {
    if (on && !timer) timer = window.setInterval(() => show((frame + 1) % PROGRESS_FRAMES), 70);
    else if (!on && timer) {
      clearInterval(timer);
      timer = 0;
    }
  };
  show(0);
  return el;
}