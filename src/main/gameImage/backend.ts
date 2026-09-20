/**
 * A Game Image is A-X-M's writable container for a backed-up game: the game's files
 * live inside it, and it can grow later when patches or save data are added.
 *
 * The rest of A-X-M only ever talks to this interface. On Windows the implementation
 * is a dynamically expanding VHDX; a SteamOS/Linux backend can be added later
 * without the menu, the metadata or the launcher knowing the difference. Nothing
 * outside this folder should mention VHDX, and nothing user-facing should either -
 * in the interface it is a Game Image.
 */

export interface GameImageStats {
  /** Bytes the image file currently occupies on the host disk. */
  allocatedBytes: number;
  /** Bytes the image is allowed to grow to. */
  maxBytes: number;
  /** Free bytes inside the image's own filesystem, or null when not mounted. */
  freeBytes: number | null;
  /** Drive letter or mount point while mounted, else null. */
  mountPath: string | null;
  mounted: boolean;
  readOnly: boolean;
}

export interface CreateImageOptions {
  /** Where the image file goes, including its extension. */
  path: string;
  /** Maximum size it may grow to, in bytes. */
  maxBytes: number;
  /** Volume label inside the image. Shown by the OS when mounted. */
  label: string;
}

export interface MountOptions {
  readOnly?: boolean;
}

/**
 * Every operation either succeeds or throws with a message fit to show the user.
 * Implementations must be safe to call when the image is already in the requested
 * state - mounting a mounted image returns its current mount rather than failing,
 * because crash recovery depends on being able to ask for a known state.
 */
export interface GameImageBackend {
  /** Identifies the backend in metadata, e.g. "vhdx". */
  readonly id: string;
  /** File extension this backend creates, including the dot. */
  readonly extension: string;

  /** True when this backend can run on the current host. */
  isAvailable(): Promise<boolean>;

  create(options: CreateImageOptions): Promise<void>;
  /** Returns the mount path. Mounting an already-mounted image returns it as-is. */
  mount(path: string, options?: MountOptions): Promise<string>;
  /** Unmounting an image that isn't mounted succeeds quietly. */
  unmount(path: string): Promise<void>;
  stats(path: string): Promise<GameImageStats>;
  /** Raises the ceiling. Never shrinks, and never touches the contents. */
  expand(path: string, maxBytes: number): Promise<void>;
  /** Reclaims unused space in the image file. Optional; may be a no-op. */
  compact(path: string): Promise<void>;
  /** Structural check of the container itself, not of the game inside it. */
  verify(path: string): Promise<boolean>;
  /** Every image this backend currently has mounted, for startup recovery. */
  listMounted(): Promise<string[]>;
}

/** Thrown for conditions worth showing the user verbatim. */
export class GameImageError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "GameImageError";
  }
}
