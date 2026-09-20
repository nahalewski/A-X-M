/** Minimal parser for Valve's VDF (KeyValues) text format - enough for libraryfolders.vdf and appmanifest_*.acf. */
export type VdfNode = { [key: string]: string | VdfNode };

export function parseVdf(text: string): VdfNode {
  let i = 0;
  const n = text.length;

  function skipWhitespaceAndComments() {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text[i] === "/" && text[i + 1] === "/") {
        while (i < n && text[i] !== "\n") i++;
        continue;
      }
      break;
    }
  }

  function readString(): string {
    skipWhitespaceAndComments();
    if (text[i] !== '"') throw new Error(`VDF parse error at ${i}: expected quote`);
    i++;
    let out = "";
    while (i < n && text[i] !== '"') {
      if (text[i] === "\\" && i + 1 < n) {
        out += text[i + 1];
        i += 2;
      } else {
        out += text[i];
        i++;
      }
    }
    i++; // closing quote
    return out;
  }

  function readObject(): VdfNode {
    const obj: VdfNode = {};
    for (;;) {
      skipWhitespaceAndComments();
      if (i >= n || text[i] === "}") {
        i++;
        return obj;
      }
      const key = readString();
      skipWhitespaceAndComments();
      if (text[i] === "{") {
        i++;
        obj[key] = readObject();
      } else {
        obj[key] = readString();
      }
    }
  }

  skipWhitespaceAndComments();
  const rootKey = readString();
  skipWhitespaceAndComments();
  if (text[i] !== "{") throw new Error("VDF parse error: expected root object");
  i++;
  const root: VdfNode = {};
  root[rootKey] = readObject();
  return root;
}
