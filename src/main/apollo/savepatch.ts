/**
 * Apollo Save Tool `.savepatch` files, parsed.
 *
 * The format is Damian "bucanero" Parrino's, documented in apollo-lib
 * (docs/savepatch.rst) and used by the apollo-patches database. This is a port of
 * the loader's rules to TypeScript; nothing here decides what a code does, it
 * only reads the file into codes, options and targets that `engine.ts` runs.
 *
 * Apollo Save Tool and its patch database are GPL-3.0 - see
 * assets/THIRD_PARTY_LICENSES.md and the credits in the Memory Card Utility.
 */

export type ApolloCodeType = "sw" | "bsd" | "python";

export interface ApolloOption {
  tag: string;
  choices: { value: string; label: string }[];
}

export interface ApolloTarget {
  /** Save folder the code is meant for ("BASLUS-20216"), or null for any. */
  folder: string | null;
  /** File pattern inside the save: "SaveData-0*", "*.DAT", "SAVEDATA.DAT". */
  file: string;
}

export interface ApolloCode {
  id: number;
  name: string;
  type: ApolloCodeType;
  /** The code body, one entry per line, comments and blanks removed. */
  lines: string[];
  /** Options referenced in the body, in the order they appear. */
  options: ApolloOption[];
  target: ApolloTarget;
  group: string | null;
  /** [DEFAULT:] - on by default. */
  isDefault: boolean;
  /** [INFO:] - shown as a note, not a patch. */
  isInfo: boolean;
  /** "(Required)" in the name - applied whenever any other code is. */
  isRequired: boolean;
  /** [LE:] / [BE:] - byte order stated by the author; null follows the platform. */
  order: "le" | "be" | null;
}

export interface ApolloPatch {
  gameId: string | null;
  title: string | null;
  author: string | null;
  targets: ApolloTarget[];
  options: ApolloOption[];
  codes: ApolloCode[];
}

/** Apollo's rule: a Save Wizard line is any 17 characters with a space in the middle ("???????? ????????"). */
function looksLikeSwLine(line: string): boolean {
  return line.length === 17 && line[8] === " ";
}

/** ":FOLDER\FILE" or ":FILE" → target. */
function parseTarget(line: string): ApolloTarget {
  const spec = line.slice(1).trim();
  const slash = spec.lastIndexOf("\\");
  if (slash >= 0) return { folder: spec.slice(0, slash) || null, file: spec.slice(slash + 1) || "*" };
  return { folder: null, file: spec || "*" };
}

function parseOption(line: string): ApolloOption | null {
  const m = line.match(/^\{([A-Za-z0-9_]+)\}(.*)\{\/\1\}\s*$/i);
  if (!m) return null;
  const choices = m[2]
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      return eq < 0 ? { value: pair, label: pair } : { value: pair.slice(0, eq).trim(), label: pair.slice(eq + 1).trim() };
    });
  return choices.length ? { tag: m[1].toUpperCase(), choices } : null;
}

export function parseSavepatch(text: string): ApolloPatch {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.replace(/\s+$/, ""));
  const patch: ApolloPatch = { gameId: null, title: null, author: null, targets: [], options: [], codes: [] };

  // The optional header: three comment lines - id, title, author.
  const head = lines.filter((l) => l.trim()).slice(0, 3);
  if (head.length === 3 && head.every((l) => l.startsWith(";"))) {
    patch.gameId = head[0].slice(1).trim() || null;
    patch.title = head[1].slice(1).trim() || null;
    patch.author = head[2].slice(1).trim().replace(/^(codes?\s*(&\s*checksum\s*fix)?\s*by|by)\s+/i, "") || null;
  }

  let target: ApolloTarget = { folder: null, file: "*" };
  let group: string | null = null;
  let current: ApolloCode | null = null;
  let id = 0;

  const finish = () => {
    if (!current) return;
    // The type, unless the header stated it: Save Wizard only when every line has that shape.
    if (current.type !== "python" && !(current as ApolloCode & { stated?: boolean }).stated) {
      current.type = current.lines.length === 0 || current.lines.every(looksLikeSwLine) ? "sw" : "bsd";
    }
    delete (current as ApolloCode & { stated?: boolean }).stated;
    // Options the body mentions.
    const seen = new Set<string>();
    for (const line of current.lines) {
      for (const m of line.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
        const tag = m[1].toUpperCase();
        const opt = patch.options.find((o) => o.tag === tag);
        if (opt && !seen.has(tag)) {
          seen.add(tag);
          current.options.push(opt);
        }
      }
    }
    patch.codes.push(current);
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith(";")) continue;
    if (line.startsWith("//")) continue;

    if (line.startsWith(":")) {
      finish();
      target = parseTarget(line);
      if (!patch.targets.some((t) => t.folder === target.folder && t.file === target.file)) patch.targets.push(target);
      continue;
    }

    const option = parseOption(line);
    if (option) {
      if (!patch.options.some((o) => o.tag === option.tag)) patch.options.push(option);
      continue;
    }

    if (line.startsWith("[") && line.endsWith("]")) {
      finish();
      let name = line.slice(1, -1).trim();
      const code: ApolloCode & { stated?: boolean } = {
        id: id++,
        name,
        type: "bsd",
        lines: [],
        options: [],
        target,
        group,
        isDefault: false,
        isInfo: false,
        isRequired: false,
        order: null,
      };
      const prefix = name.match(/^(DEFAULT|INFO|PYTHON|SW|BSD|LE|BE|GROUP):\s*/i);
      if (prefix) {
        name = name.slice(prefix[0].length).trim();
        switch (prefix[1].toUpperCase()) {
          case "DEFAULT": code.isDefault = true; break;
          case "INFO": code.isInfo = true; break;
          case "PYTHON": code.type = "python"; code.stated = true; break;
          case "SW": code.type = "sw"; code.stated = true; break;
          case "BSD": code.type = "bsd"; code.stated = true; break;
          case "LE": code.order = "le"; break;
          case "BE": code.order = "be"; break;
          case "GROUP":
            group = name === "\\" || name === "" ? null : name;
            continue;
        }
      }
      code.name = name;
      code.isRequired = /\(required\)/i.test(name);
      current = code;
      continue;
    }

    if (current) current.lines.push(line);
  }
  finish();
  return patch;
}

/** Simple wildcard match - `*` any run, `?` one character - case-insensitive, as Apollo's. */
export function wildcardMatch(pattern: string, name: string): boolean {
  const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
  return re.test(name);
}

/** Replaces {TAG} placeholders in a body with the chosen option values. */
export function substituteOptions(lines: string[], selections: Record<string, string>): string[] {
  return lines.map((l) => l.replace(/\{([A-Za-z0-9_]+)\}/g, (m, tag: string) => selections[tag.toUpperCase()] ?? m));
}
