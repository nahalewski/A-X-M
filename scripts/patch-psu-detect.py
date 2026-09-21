"""Replaces the .psu structure check with one that matches the real format.

The original check assumed the first entry was named "." and that the directory
bit was 0x2000. Both are wrong: the first entry carries the save's own name, and
the directory flag is 0x0020. Real files from the user's card proved it.

Escape text is built with chr() so no editing tool can flatten it into a control
byte on the way in.
"""
import io
import pathlib

BACKSLASH = chr(92)
ESC_NUL = BACKSLASH + "u0000"

TARGET = pathlib.Path(__file__).resolve().parent.parent / "src" / "main" / "memoryCardFormats.ts"

OLD = '''/**
 * A .psu is a stream of 512-byte entry headers. The first describes the save's
 * own directory, so its mode has the directory bit set and its name is ".".
 */
function looksLikePsu(buf: Buffer): boolean {
  if (buf.length < PS2_PAGE * 3) return false;
  const mode = buf.readUInt32LE(0);
  if ((mode & 0x2000) === 0) return false;
  const name = ascii(buf, 0x40, 32).replace(/@NUL@.*$/, "");
  if (name !== ".") return false;
  // The second entry is the parent, and every .psu has both.
  const parent = ascii(buf, PS2_PAGE + 0x40, 32).replace(/@NUL@.*$/, "");
  return parent === "..";
}'''.replace("@NUL@", ESC_NUL)

NEW = '''/** PS2 directory entry flags, as the console itself writes them. */
const PS2_EXISTS = 0x8000;
const PS2_DIRECTORY = 0x0020;

/** The name in a 512-byte entry header, which is NUL-padded to 32 bytes. */
function entryName(buf: Buffer, at: number): string {
  return ascii(buf, at + 0x40, 32).replace(/@NUL@[\\s\\S]*$/, "");
}

/**
 * A .psu is a stream of 512-byte entry headers.
 *
 * The first entry is the save's own directory and carries its name - usually the
 * game code, like BASLUS-21050 - with a count of the entries it holds. The two
 * after it are the "." and ".." the console writes into every directory, and
 * finding both is what separates a .psu from any other file that happens to open
 * with a plausible word.
 */
function looksLikePsu(buf: Buffer): boolean {
  if (buf.length < PS2_PAGE * 3) return false;

  const mode = buf.readUInt32LE(0);
  if ((mode & PS2_EXISTS) === 0) return false;
  if ((mode & PS2_DIRECTORY) === 0) return false;

  // It must name itself, and claim to hold something.
  if (entryName(buf, 0).length === 0) return false;
  if (buf.readUInt32LE(4) === 0) return false;

  return entryName(buf, PS2_PAGE) === "." && entryName(buf, PS2_PAGE * 2) === "..";
}'''.replace("@NUL@", ESC_NUL)

text = TARGET.read_text(encoding="utf-8")
if OLD not in text:
    raise SystemExit("the original looksLikePsu was not found; nothing changed")

with io.open(TARGET, "w", encoding="utf-8", newline="\n") as handle:
    handle.write(text.replace(OLD, NEW))

print("patched looksLikePsu")
