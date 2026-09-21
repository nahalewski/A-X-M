"""Rewrites cleanPackageName with regex literals that survive editing tools.

Every backslash here is built with chr(92) and never typed as an escape, so the
word boundaries stay word boundaries instead of arriving as 0x08 backspace
bytes - which is exactly what happened when this function was written through a
heredoc, and why the language tags and repacker names were not being stripped.

new RegExp is avoided on purpose: a string literal needs its backslashes
doubled, which is one more place for the same fault to reappear.
"""
import io
import pathlib

B = chr(92)          # a single backslash
WB = B + "b"         # word boundary
D = B + "d"          # digit
S = B + "s"          # whitespace
DOT = B + "."        # literal dot

TARGET = pathlib.Path(__file__).resolve().parent.parent / "src" / "main" / "pcIso.ts"

NOISE = "|".join([
    "fitgirl", "dodi", "elamigos", "el amigos", "amigos", "amigo",
    "repacks?", "multi" + D + "*", "rus", "eng",
    "selective download", "update only", "update", "crack", "cracked",
    "codex", "plaza", "skidrow", "empress", "razor1911", "goldberg", "portable",
    "gog", "proper", "readnfo",
])

NEW = """export function cleanPackageName(fileName: string): string {
  // Strip the extension, then bracketed groups - "[FitGirl Repack]", "(MULTi14)".
  let name = fileName.replace(/@DOT@[^.]+$/, "");
  name = name.replace(/[([{][^)@B@]}]*[)@B@]}]/g, " ");

  // Version numbers go before the dots become spaces, since they rely on them.
  name = name.replace(/@WB@v?@D@+(@DOT@@D@+)+/gi, " ");

  // Dots and underscores are separators in these names, not punctuation. This
  // has to happen before the tokens below are stripped, because an underscore
  // counts as a word character: "Red_Dead_MULTi14" has no word boundary before
  // MULTi, so the language tag would survive the strip.
  name = name.replace(/[._]+/g, " ");

  // Repacker names, scene tags and language markers.
  name = name.replace(/@WB@(@NOISE@)@WB@/gi, " ");

  // Counts the brackets did not catch, e.g. "+ 25 DLCs", "build 12345".
  name = name.replace(/[-+]@S@*@D@+@S@*DLCs?@WB@/gi, " ");
  name = name.replace(/@WB@build@S@*@D@+/gi, " ");

  // Collapse, then trim separators left stranded by the removals above.
  name = name.replace(/@S@{2,}/g, " ").trim();
  name = name.replace(/^[@S@@B@-+_:,]+|[@S@@B@-+_:,]+$/g, "");
  return name.trim();
}
"""

NEW = (NEW
       .replace("@NOISE@", NOISE)
       .replace("@WB@", WB)
       .replace("@DOT@", DOT)
       .replace("@D@", D)
       .replace("@S@", S)
       .replace("@B@", B))

text = TARGET.read_text(encoding="utf-8")
start = text.index("export function cleanPackageName")
end = text.index("}\n", text.index("return name.trim();", start)) + 2

with io.open(TARGET, "w", encoding="utf-8", newline="\n") as handle:
    handle.write(text[:start] + NEW + text[end:])

check = TARGET.read_text(encoding="utf-8")
stray = [hex(ord(c)) for c in check if ord(c) < 0x20 and c not in "\n\r\t"]
print("cleanPackageName rewritten")
print("stray control bytes:", stray if stray else "none")
