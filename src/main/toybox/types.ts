/**
 * Toybox: the normalized shape every toys-to-life ecosystem is converted into.
 *
 * Amiibo, Skylanders, Disney Infinity and LEGO Dimensions all identify their
 * figures differently. Rather than teach A-X-M four upstream formats, the importers
 * in the content repository flatten them into one `ToyFigure`, and everything in
 * the menu reads only this.
 *
 * Two things are kept deliberately apart:
 * - a figure is the *model*, and comes from the shared content repository.
 * - a collection entry is what *this user* owns, and never leaves their machine.
 *
 * That split is what lets the shared database be replaced wholesale on update
 * without touching anyone's collection, favourites or custom tag mappings.
 */

export type ToyPlatform = "amiibo" | "skylanders" | "disney-infinity" | "lego-dimensions" | "generic";

/** Bumped when the on-disk shape changes in a way importers must follow. */
export const TOYBOX_SCHEMA_VERSION = 1;

/**
 * Where a figure's pictures come from. Character art for these franchises is owned
 * by Nintendo, Activision, Disney and LEGO/Warner respectively, so the shared
 * repository holds a *reference* rather than the file unless redistribution is
 * explicitly permitted. A-X-M may cache a referenced image locally at runtime; it
 * never republishes one.
 */
export interface ToyMedia {
  /** Small image bundled in the repository, when one may be redistributed. */
  thumbnail?: string;
  /** Full transparent render bundled in the repository, when permitted. */
  png?: string;
  /** Wide image for the focus screen, when permitted. */
  hero?: string;
  /** Reserved: Toybox may show 3D models later. */
  model3d?: string;
  /** Used when nothing above may be bundled. Fetched and cached locally, not shipped. */
  remoteArtwork?: string;
  /** Who owns that remote image. Shown in About, never omitted. */
  copyrightOwner?: string;
  /** False means: reference only, never copy into the repository. */
  redistributable?: boolean;
}

/** Where a record came from, so credits can be generated rather than remembered. */
export interface ToySource {
  type: "metadata" | "artwork";
  project: string;
  url: string;
  license?: string;
  /** ISO date the record was pulled. */
  retrieved?: string;
}

/** How a physical tag is recognised, without holding any of the tag's contents. */
export interface ToyNfc {
  /** e.g. "ntag215", "mifare-classic-1k". */
  technology?: string;
  /**
   * What the identifier below actually is. A-X-M stores only enough to say "this
   * tag is Spyro" - never dumps, keys or decrypted game data.
   */
  identifierType?: "head-tail" | "character-variant" | "uid" | "other";
  /** Amiibo: head ID. */
  head?: string;
  /** Amiibo: tail ID. */
  tail?: string;
  /** Skylanders / Disney Infinity / LEGO: character number. */
  characterId?: string;
  /** Skylanders: variant number. */
  variantId?: string;
}

export interface ToyFigure {
  schemaVersion: number;
  /** Stable, human-readable, unique across every platform. */
  id: string;
  platform: ToyPlatform;
  name: string;
  franchise?: string;
  series?: string;
  manufacturer?: string;
  variant?: string;
  /** Free-form per-platform extras: element, wave, playset, amiibo series, and so on. */
  attributes?: Record<string, string>;
  nfc?: ToyNfc;
  media?: ToyMedia;
  /** A-X-M game ids this figure works with. Matched against the installed library. */
  compatibleGames?: string[];
  sources?: ToySource[];
}

/** The manifest the content repository publishes, and A-X-M checks for updates. */
export interface ToyboxManifest {
  databaseVersion: number;
  schemaVersion: number;
  /** ISO timestamp. */
  updatedAt: string;
  figures: Record<string, number>;
}

/** What the user owns or wants. Lives in their user data, never in the repository. */
export interface ToyCollectionEntry {
  figureId: string;
  owned: boolean;
  wanted: boolean;
  favorite: boolean;
  /** Several copies or variants of the same model. */
  copies?: number;
  /** ISO timestamp of the last scan. */
  lastScanned?: string;
  notes?: string;
}

/** A tag the database doesn't know, or one the user mapped to an action themselves. */
export interface ToyCustomTag {
  uid: string;
  label: string;
  /** Maps to a figure, or to a menu action for a plain NFC card. */
  figureId?: string;
  action?: { kind: "launch-game" | "open-category" | "open-figure"; target: string };
  created: string;
}

/** Everything Toybox keeps for one user, alongside the shared database. */
export interface ToyboxUserData {
  collection: Record<string, ToyCollectionEntry>;
  customTags: ToyCustomTag[];
  /** Figure ids, most recent first. */
  recentlyScanned: string[];
  /** figure id -> the A-X-M game it was last launched with. Local only. */
  lastGame?: Record<string, string>;
}

/**
 * One scan, whatever read it. Every reader - the PC/SC script, the Android
 * companion, a portal adapter, the test hook - ends in this event; Ghost and the
 * menu only ever see this shape, never the hardware.
 */
export interface ToyboxDetectionEvent {
  /** Null when the tag isn't in the database (an "unknown toy"). */
  figureId: string | null;
  ecosystem: ToyPlatform | "custom";
  name: string;
  character?: string;
  variant?: string;
  series?: string;
  franchise?: string;
  artwork?: { thumbnail?: string; png?: string; hero?: string };
  /** Slugs from the record; the renderer resolves them against installed games. */
  compatibleGameIds: string[];
  reader: { id: string; type: "pcsc" | "companion" | "portal" | "simulated" | string };
  /** The tag's UID, for custom mappings and removal matching. Never spoken. */
  uid: string;
  detectedAt: number;
  /** A read-only copy of the tag on disk, when the reader could take one (for emulators). */
  dumpPath?: string;
  /** Emulator folders the copy was also placed in (Eden's amiibo folder, RPCS3's). */
  handedTo?: string[];
}

export interface ToyboxRemovalEvent {
  uid: string;
  figureId: string | null;
  reader: { id: string; type: string };
  removedAt: number;
}

export interface ToyboxStats {
  /** Figures per platform in the loaded database. */
  byPlatform: Record<string, number>;
  total: number;
  /** Figures with a bundled image. */
  withArtwork: number;
  /** Figures with no image at all, bundled or referenced. */
  missingArtwork: number;
  databaseVersion: number | null;
  updatedAt: string | null;
}
