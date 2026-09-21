import { app } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  TOYBOX_SCHEMA_VERSION,
  ToyCollectionEntry,
  ToyCustomTag,
  ToyFigure,
  ToyboxManifest,
  ToyboxStats,
  ToyboxUserData,
  ToyPlatform,
} from "./types";

/**
 * The only thing that reads Toybox's data files. The menu, Ghost and the reader
 * layer all go through this, so none of them ever parse the repository themselves.
 *
 * Two stores, deliberately separate:
 *
 * - the shared database, downloaded from the content repository into userData. It
 *   is replaced wholesale on update and holds nothing about the user.
 * - the user's own file: what they own, what they want, favourites, recent scans
 *   and their private tag mappings. Never uploaded, and never touched by an update.
 *
 * Everything is loaded once and indexed in memory. A scan has to resolve a tag to a
 * figure in milliseconds without touching the network, so lookups are map hits, and
 * the database is only re-read when it actually changes on disk.
 */

const RECENT_LIMIT = 40;

function toyboxDir(): string {
  return path.join(app.getPath("userData"), "toybox");
}

function databasePath(): string {
  return path.join(toyboxDir(), "figures.json");
}

function manifestPath(): string {
  return path.join(toyboxDir(), "manifest.json");
}

function userDataPath(): string {
  return path.join(toyboxDir(), "collection.json");
}

/** Lower-cased, punctuation-free, for forgiving name matching. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The key a scanned tag is looked up by. Each ecosystem identifies figures
 * differently, so the key is built from whichever fields that platform actually
 * uses - which is why the database can be indexed once and queried by any of them.
 */
export function tagKey(platform: ToyPlatform, parts: { head?: string; tail?: string; characterId?: string; variantId?: string; uid?: string }): string {
  const clean = (v?: string) => (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (platform === "amiibo" && (parts.head || parts.tail)) {
    return `amiibo:${clean(parts.head)}-${clean(parts.tail)}`;
  }
  if (parts.characterId) {
    return `${platform}:${clean(parts.characterId)}-${clean(parts.variantId) || "0"}`;
  }
  return `${platform}:uid:${clean(parts.uid)}`;
}

const EMPTY_USER_DATA: ToyboxUserData = { collection: {}, customTags: [], recentlyScanned: [], lastGame: {} };

export class ToyboxService {
  private figures: ToyFigure[] = [];
  private byId = new Map<string, ToyFigure>();
  private byTag = new Map<string, ToyFigure>();
  /** Normalised name and franchise words, for offline search. */
  private searchRows: { figure: ToyFigure; haystack: string }[] = [];

  private manifest: ToyboxManifest | null = null;
  private userData: ToyboxUserData = { ...EMPTY_USER_DATA };
  private loaded = false;

  /**
   * Reads both stores. Safe to call repeatedly; the second call is a no-op unless
   * `force` is set, which is what an update uses after replacing the files.
   */
  load(force = false): void {
    if (this.loaded && !force) return;
    this.loadDatabase();
    this.loadUserData();
    this.loaded = true;
  }

  /** True once a database has been downloaded. Everything still works without one. */
  hasDatabase(): boolean {
    this.load();
    return this.figures.length > 0;
  }

  private loadDatabase(): void {
    this.figures = [];
    this.byId.clear();
    this.byTag.clear();
    this.searchRows = [];
    this.manifest = null;

    try {
      const raw = fs.readFileSync(databasePath(), "utf-8");
      const parsed = JSON.parse(raw) as { figures?: ToyFigure[] } | ToyFigure[];
      const list = Array.isArray(parsed) ? parsed : (parsed.figures ?? []);
      // A record written against a newer schema is skipped rather than guessed at.
      this.figures = list.filter((f) => f && f.id && (f.schemaVersion ?? 1) <= TOYBOX_SCHEMA_VERSION);
    } catch {
      this.figures = [];
    }

    try {
      this.manifest = JSON.parse(fs.readFileSync(manifestPath(), "utf-8")) as ToyboxManifest;
    } catch {
      this.manifest = null;
    }

    for (const figure of this.figures) {
      this.byId.set(figure.id, figure);

      const nfc = figure.nfc;
      if (nfc) {
        const key = tagKey(figure.platform, {
          head: nfc.head,
          tail: nfc.tail,
          characterId: nfc.characterId,
          variantId: nfc.variantId,
        });
        // First writer wins: a duplicate key means the importer produced two records
        // for one tag, which validation in the content repository should have caught.
        if (!this.byTag.has(key)) this.byTag.set(key, figure);
      }

      this.searchRows.push({
        figure,
        haystack: normalise(
          [figure.name, figure.franchise, figure.series, figure.variant, figure.platform, ...Object.values(figure.attributes ?? {})]
            .filter(Boolean)
            .join(" ")
        ),
      });
    }
  }

  private loadUserData(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(userDataPath(), "utf-8")) as Partial<ToyboxUserData>;
      this.userData = {
        collection: parsed.collection ?? {},
        customTags: Array.isArray(parsed.customTags) ? parsed.customTags : [],
        recentlyScanned: Array.isArray(parsed.recentlyScanned) ? parsed.recentlyScanned : [],
        lastGame: parsed.lastGame && typeof parsed.lastGame === "object" ? parsed.lastGame : {},
      };
    } catch {
      this.userData = { collection: {}, customTags: [], recentlyScanned: [], lastGame: {} };
    }
  }

  /** Written whole, to a temp file first, so a crash can't leave a half-written collection. */
  private saveUserData(): void {
    try {
      fs.mkdirSync(toyboxDir(), { recursive: true });
      const target = userDataPath();
      const temp = `${target}.tmp`;
      fs.writeFileSync(temp, JSON.stringify(this.userData, null, 2), "utf-8");
      fs.renameSync(temp, target);
    } catch (err) {
      console.error("[A-X-M] could not save the Toybox collection:", err);
    }
  }

  // ------------------------------------------------------------------ reads --

  getFigureById(id: string): ToyFigure | null {
    this.load();
    return this.byId.get(id) ?? null;
  }

  /** Resolves a scanned tag to a figure, or null when the database doesn't know it. */
  identifyTag(platform: ToyPlatform, parts: { head?: string; tail?: string; characterId?: string; variantId?: string; uid?: string }): ToyFigure | null {
    this.load();
    const direct = this.byTag.get(tagKey(platform, parts));
    if (direct) return direct;

    // A user-made mapping covers tags the shared database has never heard of.
    if (parts.uid) {
      const custom = this.userData.customTags.find((t) => t.uid.toLowerCase() === parts.uid!.toLowerCase());
      if (custom?.figureId) return this.byId.get(custom.figureId) ?? null;
    }
    return null;
  }

  getFiguresByPlatform(platform: ToyPlatform): ToyFigure[] {
    this.load();
    return this.figures.filter((f) => f.platform === platform);
  }

  /**
   * Offline substring search over name, franchise, series, variant and per-platform
   * attributes. Every query term has to appear, so "star wars batman" narrows rather
   * than widening.
   */
  searchFigures(query: string, limit = 100): ToyFigure[] {
    this.load();
    const terms = normalise(query).split(" ").filter(Boolean);
    if (terms.length === 0) return [];

    const hits: ToyFigure[] = [];
    for (const row of this.searchRows) {
      if (terms.every((t) => row.haystack.includes(t))) {
        hits.push(row.figure);
        if (hits.length >= limit) break;
      }
    }
    return hits;
  }

  getFavorites(): ToyFigure[] {
    this.load();
    return Object.values(this.userData.collection)
      .filter((e) => e.favorite)
      .map((e) => this.byId.get(e.figureId))
      .filter((f): f is ToyFigure => !!f);
  }

  getCollection(filter: "all" | "owned" | "missing" | "favorites" = "all"): ToyFigure[] {
    this.load();
    if (filter === "all") return this.figures;
    if (filter === "missing") {
      return this.figures.filter((f) => !this.userData.collection[f.id]?.owned);
    }
    return Object.values(this.userData.collection)
      .filter((e) => (filter === "owned" ? e.owned : e.favorite))
      .map((e) => this.byId.get(e.figureId))
      .filter((f): f is ToyFigure => !!f);
  }

  getRecentlyScanned(): ToyFigure[] {
    this.load();
    return this.userData.recentlyScanned.map((id) => this.byId.get(id)).filter((f): f is ToyFigure => !!f);
  }

  getEntry(figureId: string): ToyCollectionEntry | null {
    this.load();
    return this.userData.collection[figureId] ?? null;
  }

  getCustomTags(): ToyCustomTag[] {
    this.load();
    return this.userData.customTags;
  }

  // ----------------------------------------------------------------- writes --

  /** Merges into the existing entry, so setting `favorite` never clears `owned`. */
  setCollectionState(figureId: string, patch: Partial<Omit<ToyCollectionEntry, "figureId">>): ToyCollectionEntry {
    this.load();
    const existing = this.userData.collection[figureId] ?? {
      figureId,
      owned: false,
      wanted: false,
      favorite: false,
    };
    const updated: ToyCollectionEntry = { ...existing, ...patch, figureId };
    this.userData.collection[figureId] = updated;
    this.saveUserData();
    return updated;
  }

  /** Records a scan. Moves the figure to the front rather than duplicating it. */
  noteScanned(figureId: string): void {
    this.load();
    const recent = this.userData.recentlyScanned.filter((id) => id !== figureId);
    recent.unshift(figureId);
    this.userData.recentlyScanned = recent.slice(0, RECENT_LIMIT);

    const entry = this.userData.collection[figureId];
    // Scanning something is proof the user has it in their hands.
    this.userData.collection[figureId] = {
      figureId,
      owned: true,
      wanted: entry?.wanted ?? false,
      favorite: entry?.favorite ?? false,
      copies: entry?.copies,
      notes: entry?.notes,
      lastScanned: new Date().toISOString(),
    };
    this.saveUserData();
  }

  /** The game this figure was last launched with, so the next scan can offer "Resume". */
  lastGame(figureId: string): string | null {
    this.load();
    return this.userData.lastGame?.[figureId] ?? null;
  }

  setLastGame(figureId: string, gameId: string): void {
    this.load();
    this.userData.lastGame = { ...(this.userData.lastGame ?? {}), [figureId]: gameId };
    this.saveUserData();
  }

  saveCustomTag(tag: ToyCustomTag): void {
    this.load();
    const rest = this.userData.customTags.filter((t) => t.uid.toLowerCase() !== tag.uid.toLowerCase());
    this.userData.customTags = [...rest, tag];
    this.saveUserData();
  }

  removeCustomTag(uid: string): void {
    this.load();
    this.userData.customTags = this.userData.customTags.filter((t) => t.uid.toLowerCase() !== uid.toLowerCase());
    this.saveUserData();
  }

  // ------------------------------------------------------------------ stats --

  getStats(): ToyboxStats {
    this.load();
    const byPlatform: Record<string, number> = {};
    let withArtwork = 0;
    let missingArtwork = 0;

    for (const figure of this.figures) {
      byPlatform[figure.platform] = (byPlatform[figure.platform] ?? 0) + 1;
      const media = figure.media;
      if (media?.png || media?.thumbnail) withArtwork++;
      else if (!media?.remoteArtwork) missingArtwork++;
    }

    return {
      byPlatform,
      total: this.figures.length,
      withArtwork,
      missingArtwork,
      databaseVersion: this.manifest?.databaseVersion ?? null,
      updatedAt: this.manifest?.updatedAt ?? null,
    };
  }

  getManifest(): ToyboxManifest | null {
    this.load();
    return this.manifest;
  }

  /** Where an update writes to. Exposed so the download path has one source of truth. */
  paths(): { dir: string; database: string; manifest: string } {
    return { dir: toyboxDir(), database: databasePath(), manifest: manifestPath() };
  }
}

export const toybox = new ToyboxService();
