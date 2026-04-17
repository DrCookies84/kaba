"""Package dxt-build/ into kaba-0.2.0.dxt (zip format, Windows path separators)."""
import os
import sys
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src = root / "dxt-build"
dst = root / "kaba-0.2.0.dxt"

if dst.exists():
    dst.unlink()

count = 0
with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for p in src.rglob("*"):
        if p.is_file():
            rel = p.relative_to(src).as_posix().replace("/", "\\")
            zf.write(p, rel)
            count += 1

print(f"Wrote {dst} ({dst.stat().st_size:,} bytes, {count} files)")
