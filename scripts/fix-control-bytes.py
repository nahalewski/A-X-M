"""Turns stray control bytes in TypeScript sources back into escape text.

Editing tools decode escape sequences in their arguments, so a line that should
read backslash-u-0-0-0-0 can arrive on disk as a single NUL byte. TypeScript
still compiles, and the code still mostly works, which is what makes it nasty:
a character class written as NUL-to-US silently becomes a range that strips
spaces and punctuation from save names.

Every literal here is built with chr() and never typed as an escape, so running
this through any tool cannot reintroduce the fault it repairs.

Run with no arguments to check and fix everything under src/.
"""
import io
import pathlib
import sys

BACKSLASH = chr(92)
KEEP = "\n\r\t"

ROOT = pathlib.Path(__file__).resolve().parent.parent


def escape_for(ch):
    """The six-character escape text for a control character."""
    return BACKSLASH + "u" + format(ord(ch), "04x")


def repair(path):
    text = path.read_text(encoding="utf-8")
    stray = [c for c in text if ord(c) < 0x20 and c not in KEEP]
    if not stray:
        return 0

    fixed = "".join(escape_for(c) if (ord(c) < 0x20 and c not in KEEP) else c for c in text)
    with io.open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(fixed)
    return len(stray)


def main():
    targets = [pathlib.Path(a) for a in sys.argv[1:]] or sorted(ROOT.glob("src/**/*.ts"))
    total = 0
    for path in targets:
        count = repair(path)
        if count:
            print(f"{path.relative_to(ROOT) if ROOT in path.parents else path}: repaired {count}")
            total += count
    print(f"{total} stray control byte(s) repaired")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
