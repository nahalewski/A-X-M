"""
Decrypts a PlayStation 3 disc image (a Redump-style .iso) with its disc key, so
the game can be extracted into the folder layout RPCS3 boots.

    python ps3_decrypt.py <game.iso> <key.dkey or 32 hex chars> <out.iso> [--check]

The image's first sector lists its regions; plain and encrypted regions
alternate, and each 2048-byte sector of an encrypted region is AES-128-CBC with
the disc key (the .dkey value, used as is - checked against LIC.DAT, EBOOT.BIN and
ICON0.PNG on a real disc) and the sector number as the IV.
Progress lines ("PROGRESS <done> <total>") go to stdout for the menu's toast.
--check decrypts the first encrypted sector only and prints it, for a sanity look.

Needs pycryptodome (Crypto.Cipher), which the app's Python environment has.
"""

import os
import sys

from Crypto.Cipher import AES

SECTOR = 2048


def disc_key(dkey_text):
    return bytes.fromhex(dkey_text.strip()[:32])


def regions(header):
    count_plain = int.from_bytes(header[0:4], "big")
    total = count_plain * 2 - 1
    ends = [int.from_bytes(header[8 + i * 4 : 12 + i * 4], "big") for i in range(total + 1)]
    out = []
    # The listed boundary sectors themselves are plain (the one before an encrypted
    # run is zero padding, the one after starts the next plain run).
    for i in range(total):
        start, end = ends[i], ends[i + 1]
        encrypted = i % 2 == 1
        if encrypted:
            start, end = start + 1, end - 1
        out.append((start, end, encrypted))
    return out


def main():
    src, key_arg, dst = sys.argv[1], sys.argv[2], sys.argv[3]
    check = "--check" in sys.argv
    if os.path.isfile(key_arg):
        with open(key_arg, "r", encoding="utf-8", errors="ignore") as f:
            key_arg = f.read()
    key = disc_key(key_arg)
    size = os.path.getsize(src)
    total_sectors = size // SECTOR
    with open(src, "rb") as f:
        header = f.read(SECTOR)
    regs = regions(header)
    if check:
        s = next(r[0] for r in regs if r[2])
        with open(src, "rb") as f:
            f.seek(s * SECTOR)
            enc = f.read(SECTOR)
        iv = s.to_bytes(16, "big")
        dec = AES.new(key, AES.MODE_CBC, iv).decrypt(enc)
        print("regions:", regs)
        print("first encrypted sector", hex(s), "distinct bytes:", len(set(dec)), "head:", dec[:32].hex())
        return
    done = 0
    last = -1
    with open(src, "rb") as fin, open(dst, "wb") as fout:
        for start, end, encrypted in regs:
            sector = start
            while sector <= end and sector < total_sectors:
                n = min(4096, end - sector + 1)
                fin.seek(sector * SECTOR)
                chunk = fin.read(n * SECTOR)
                if not chunk:
                    break
                if encrypted:
                    out = bytearray(len(chunk))
                    for i in range(0, len(chunk), SECTOR):
                        iv = (sector + i // SECTOR).to_bytes(16, "big")
                        out[i : i + SECTOR] = AES.new(key, AES.MODE_CBC, iv).decrypt(chunk[i : i + SECTOR])
                    fout.write(out)
                else:
                    fout.write(chunk)
                sector += n
                done = sector
                pct = done * 100 // total_sectors
                if pct != last:
                    last = pct
                    print(f"PROGRESS {done} {total_sectors}", flush=True)
        # Anything past the last region (padding) is copied as is.
        fin.seek(done * SECTOR)
        rest = fin.read()
        if rest:
            fout.write(rest)
    print(f"PROGRESS {total_sectors} {total_sectors}", flush=True)
    print("DONE", flush=True)


if __name__ == "__main__":
    main()
