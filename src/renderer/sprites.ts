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
