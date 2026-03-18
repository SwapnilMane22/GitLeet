#!/usr/bin/env python3
"""Generate solid placeholder PNGs in extension/assets/icons/. Stdlib only."""
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "extension", "assets", "icons")
# GitLeet green (matches UI accent)
R, G, B, A = 22, 163, 74, 255


def write_png(path: str, w: int, h: int) -> None:
    row = b"\x00" + bytes([R, G, B, A]) * w
    raw = row * h
    comp = zlib.compress(raw, 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", comp) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(data)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for s in (16, 32, 48, 128):
        write_png(os.path.join(OUT, f"icon{s}.png"), s, s)
    print("Wrote:", OUT)


if __name__ == "__main__":
    main()
