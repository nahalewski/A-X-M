"""
A-X-M Toybox reader for PC/SC readers (ACR122U and friends).

Polls every reader, and for each tag that appears works out what toy it is and
prints one JSON line the menu turns into a ToyboxDetectionEvent:

    {"event":"tag","reader":"ACS ACR122U 0","uid":"04a1b2c3d4e5f6","tech":"ntag215",
     "ecosystem":"amiibo","head":"01000000","tail":"000c0002"}
    {"event":"removed","reader":"ACS ACR122U 0","uid":"04a1b2c3d4e5f6"}

Only enough is read to identify the toy:
  - amiibo (NTAG215)          pages 0x15-0x16 hold the head / tail identity
  - LEGO Dimensions (NTAG213)  pages 0x24-0x25 after PWD_AUTH; the character id is
                              TEA-encrypted with a key made from the UID (vehicles
                              are plain, flagged by page 0x26)
  - Skylanders (MIFARE 1K)    sector 0 with its fixed key; block 1 holds id + variant
  - Disney Infinity (MIFARE)  sector 0 with the SHA-1 derived key; block 1 is AES,
                              the model number sits in its decrypted bytes 1-3

Nothing is written to a tag, and no dump leaves this process. Needs pyscard, and
pycryptodome for Infinity (both installed by Settings › System › Install Tools).
"""

import base64
import binascii
import hashlib
import json
import struct
import sys
import time

try:
    from smartcard.System import readers as pcsc_readers
    from smartcard.Exceptions import CardConnectionException, NoCardException
except Exception as e:  # noqa: BLE001
    print(json.dumps({"event": "error", "error": f"pyscard missing: {e}"}), flush=True)
    sys.exit(2)


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def hexs(b):
    return binascii.hexlify(bytes(b)).decode()


# ------------------------------------------------------------------ LEGO ----

def _rotr(v, n):
    return ((v >> n) | (v << (32 - n))) & 0xFFFFFFFF


def lego_password(uid):
    basic = bytearray(b"\xff" * 7 + b"\x28\x63\x29\x20\x43\x6f\x70\x79\x72\x69\x67\x68\x74\x20\x4c\x45\x47\x4f\x20\x32\x30\x31\x34\xaa\xaa")
    basic[0:7] = uid[:7]
    v2 = 0
    for i in range(8):
        b = struct.unpack_from("<I", basic, i * 4)[0]
        v2 = (b + _rotr(v2, 25) + _rotr(v2, 10) - v2) & 0xFFFFFFFF
    return struct.pack("<I", v2)


def _scramble(uid, cnt):
    basic = bytearray(b"\xff" * 7 + b"\xb7\xd5\xd7\xe6\xe7\xba\x3c\xa8\xd8\x75\x47\x68\xcf\x23\xe9\xfe\xaa")
    basic[0:7] = uid[:7]
    basic[cnt * 4 - 1] = 0xAA
    v2 = 0
    for i in range(cnt):
        b = struct.unpack_from("<I", basic, i * 4)[0]
        v2 = (b + _rotr(v2, 25) + _rotr(v2, 10) - v2) & 0xFFFFFFFF
    return v2


def lego_character_id(uid, data8):
    k = [_scramble(uid, 3), _scramble(uid, 4), _scramble(uid, 5), _scramble(uid, 6)]
    v0, v1 = struct.unpack("<II", bytes(data8[:8]))
    total = 0xC6EF3720
    delta = 0x9E3779B9
    m = 0xFFFFFFFF
    for _ in range(32):
        v1 = (v1 - ((((v0 << 4) & m) + k[2]) ^ ((v0 + total) & m) ^ ((v0 >> 5) + k[3]))) & m
        v0 = (v0 - ((((v1 << 4) & m) + k[0]) ^ ((v1 + total) & m) ^ ((v1 >> 5) + k[1]))) & m
        total = (total - delta) & m
    if v0 != v1:
        return 0
    return v0 & 0xFFFF


# -------------------------------------------------------- Disney Infinity ----

_MAGIC = [3, 5, 7, 23, 9985861487287759675192201655940647, 38844225342798321268237511320137937]
_SHA1_CONSTANT = bytes([0xAF, 0x62, 0xD2, 0xEC, 0x04, 0x91, 0x96, 0x8C, 0xC5, 0x2A, 0x1A, 0x71, 0x65, 0xF8, 0x65, 0xFE,
                        0x28, 0x63, 0x29, 0x20, 0x44, 0x69, 0x73, 0x6E, 0x65, 0x79, 0x20, 0x32, 0x30, 0x31, 0x33])


def infinity_key_a(uid7):
    pre = format(_MAGIC[0] * _MAGIC[1] * _MAGIC[3] * _MAGIC[5], "032x")
    post = format(_MAGIC[0] * _MAGIC[2] * _MAGIC[4], "030x")
    key = hashlib.sha1(binascii.unhexlify(pre + hexs(uid7) + post)).digest()
    return key[3::-1] + key[7:5:-1]


def infinity_model_number(uid7, block1):
    try:
        from Crypto.Cipher import AES  # pycryptodome
    except Exception:  # noqa: BLE001
        return None
    digest = hashlib.sha1(_SHA1_CONSTANT + bytes(uid7[:7])).digest()
    key = bytearray(16)
    for i in range(4):
        for x in range(4):
            key[x + i * 4] = digest[(3 - x) + i * 4]
    dec = AES.new(bytes(key), AES.MODE_ECB).decrypt(bytes(block1[:16]))
    return (dec[1] << 16) | (dec[2] << 8) | dec[3]


SKYLANDER_KEY_A = bytes([0x4B, 0x0B, 0x20, 0x10, 0x7C, 0xCB])


def _crc48(data):
    poly = 0x42F0E1EBA9EA3693
    crc = 0x9AE903260CC4
    for b in data:
        crc ^= b << 40
        for _ in range(8):
            crc = ((crc << 1) ^ poly) if crc & 0x800000000000 else (crc << 1)
            crc &= 0xFFFFFFFFFFFF
    return crc


def skylander_key_a(uid4, sector):
    """Sector 0 uses the fixed key; the rest come from a CRC-48 of the UID and sector number."""
    if sector == 0:
        return SKYLANDER_KEY_A
    return _crc48(bytes(uid4[:4]) + bytes([sector])).to_bytes(6, "big")


# ------------------------------------------------------------------ dumps ----
# A copy of the tag for the emulators that load figures from files (Eden / yuzu /
# Ryujinx take an amiibo .bin, RPCS3's emulated portals take .sky / Infinity .bin).
# Read-only: the tag is never written, and the copy stays in the user's data folder.

def dump_amiibo(conn):
    out = bytearray()
    for page in range(0, 135, 4):
        chunk = read_pages(conn, page, 16)
        if not chunk:
            return None
        out += chunk
    return bytes(out[:540])


def dump_skylander(conn, uid):
    out = bytearray()
    for sector in range(16):
        key = skylander_key_a(uid, sector)
        if not mifare_auth(conn, sector * 4, key):
            # Try the other byte order once; the CRC convention differs between sources.
            if not mifare_auth(conn, sector * 4, key[::-1]):
                return None
        for block in range(4):
            data = mifare_read(conn, sector * 4 + block)
            if not data:
                return None
            out += data
    return bytes(out)


def dump_infinity(conn, key):
    out = bytearray()
    for sector in range(5):
        if not mifare_auth(conn, sector * 4, key):
            return None
        for block in range(4):
            data = mifare_read(conn, sector * 4 + block)
            if not data:
                return None
            out += data
    return bytes(out)


# ------------------------------------------------------------- transport ----

def apdu(conn, data):
    resp, sw1, sw2 = conn.transmit(list(data))
    return bytes(resp), sw1, sw2


def get_uid(conn):
    resp, sw1, sw2 = apdu(conn, [0xFF, 0xCA, 0x00, 0x00, 0x00])
    return resp if sw1 == 0x90 else None


def read_pages(conn, page, n=16):
    resp, sw1, sw2 = apdu(conn, [0xFF, 0xB0, 0x00, page, n])
    return resp if sw1 == 0x90 else None


def ntag_pwd_auth(conn, pwd4):
    # InCommunicateThru: PN532 wraps the raw NTAG PWD_AUTH (0x1B) for us.
    resp, sw1, sw2 = apdu(conn, [0xFF, 0x00, 0x00, 0x00, 0x07, 0xD4, 0x42, 0x1B] + list(pwd4))
    return sw1 == 0x90 and len(resp) >= 3 and resp[0] == 0xD5 and resp[2] == 0x00


def mifare_auth(conn, block, key):
    _, sw1, _ = apdu(conn, [0xFF, 0x82, 0x00, 0x00, 0x06] + list(key))
    if sw1 != 0x90:
        return False
    _, sw1, _ = apdu(conn, [0xFF, 0x86, 0x00, 0x00, 0x05, 0x01, 0x00, block, 0x60, 0x00])
    return sw1 == 0x90


def mifare_read(conn, block):
    resp, sw1, _ = apdu(conn, [0xFF, 0xB0, 0x00, block, 0x10])
    return resp if sw1 == 0x90 else None


def identify(conn, atr):
    uid = get_uid(conn)
    if not uid:
        return None
    out = {"uid": hexs(uid)}
    atr_hex = hexs(atr)
    # PC/SC part 3 ATRs name the card family after "A0 00 00 03 06 03": 00 01 = MIFARE 1K, 00 03 = Ultralight/NTAG.
    ultralight = "a000000306030003" in atr_hex or len(uid) == 7
    mifare = "a000000306030001" in atr_hex or "a000000306030002" in atr_hex

    if ultralight and not mifare:
        cc = read_pages(conn, 3, 4) or b""
        size = cc[2] if len(cc) >= 3 else 0
        # amiibo are NTAG215 with the capability container F1 10 FF EE; their identity
        # sits in pages 0x15-0x16 and every tail ends in 02.
        if size != 0x12 and size != 0x0F:
            ident = read_pages(conn, 0x15, 8)
            if ident and len(ident) >= 8 and ident[7] == 0x02 and any(ident[0:4]):
                out.update({"tech": "ntag215", "ecosystem": "amiibo", "head": hexs(ident[0:4]), "tail": hexs(ident[4:8])})
                dump = dump_amiibo(conn)
                if dump:
                    out["dump"] = base64.b64encode(dump).decode()
                    out["dumpExt"] = "bin"
                return out
        if size in (0x12, 0x0F):  # NTAG213 / 212 -> LEGO Dimensions
            if ntag_pwd_auth(conn, lego_password(uid)):
                data = read_pages(conn, 0x24, 12)
                if data and len(data) >= 12:
                    out["tech"] = "ntag213"
                    out["ecosystem"] = "lego-dimensions"
                    if data[8:12] == b"\x00\x01\x00\x00":
                        out["characterId"] = str(struct.unpack("<H", bytes(data[0:2]))[0])
                        out["kind"] = "vehicle"
                    else:
                        out["characterId"] = str(lego_character_id(uid, data[0:8]))
                        out["kind"] = "character"
                    out["variantId"] = "0"
                    return out
        out["tech"] = "ntag"
        return out

    # MIFARE Classic: Skylanders first (fixed key), then Infinity (derived key).
    if mifare_auth(conn, 1, SKYLANDER_KEY_A):
        b1 = mifare_read(conn, 1)
        if b1 and len(b1) >= 16:
            out.update({"tech": "mifare-classic-1k", "ecosystem": "skylanders",
                        "characterId": str(struct.unpack("<H", bytes(b1[0:2]))[0]),
                        "variantId": str(struct.unpack("<H", bytes(b1[12:14]))[0])})
            dump = dump_skylander(conn, uid)
            if dump:
                out["dump"] = base64.b64encode(dump).decode()
                out["dumpExt"] = "sky"
            return out
    if len(uid) >= 7 and mifare_auth(conn, 1, infinity_key_a(uid[:7])):
        b1 = mifare_read(conn, 1)
        if b1 and len(b1) >= 16:
            number = infinity_model_number(uid[:7], b1)
            out.update({"tech": "mifare-classic-1k", "ecosystem": "disney-infinity"})
            dump = dump_infinity(conn, infinity_key_a(uid[:7]))
            if dump:
                out["dump"] = base64.b64encode(dump).decode()
                out["dumpExt"] = "bin"
            if number:
                out["characterId"] = str(number)
                out["variantId"] = "0"
            return out
    out["tech"] = "mifare-classic-1k" if mifare else "unknown"
    return out


def main():
    present = {}  # reader name -> uid
    known = set()
    emit({"event": "started"})
    while True:
        try:
            rs = pcsc_readers()
        except Exception as e:  # noqa: BLE001
            emit({"event": "error", "error": f"PC/SC unavailable: {e}"})
            time.sleep(3)
            continue
        names = [str(r) for r in rs]
        if set(names) != known:
            known = set(names)
            emit({"event": "readers", "list": names})
        for r in rs:
            name = str(r)
            conn = r.createConnection()
            try:
                conn.connect()
                atr = bytes(conn.getATR())
                info = identify(conn, atr)
                conn.disconnect()
            except (NoCardException, CardConnectionException):
                info = None
            except Exception as e:  # noqa: BLE001
                emit({"event": "error", "reader": name, "error": str(e)[:200]})
                info = None
            if info and info.get("uid"):
                if present.get(name) != info["uid"]:
                    present[name] = info["uid"]
                    emit({"event": "tag", "reader": name, **info})
            elif name in present:
                emit({"event": "removed", "reader": name, "uid": present.pop(name)})
        for gone in [n for n in present if n not in names]:
            emit({"event": "removed", "reader": gone, "uid": present.pop(gone)})
        time.sleep(0.25)


if __name__ == "__main__":
    main()
