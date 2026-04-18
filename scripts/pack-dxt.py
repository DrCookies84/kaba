"""Package dxt-build/ into kaba-<version>.dxt (zip format).

Version is read from package.json so future version bumps only need to be
made in one place.
"""
import json
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
pkg = json.loads((root / "package.json").read_text(encoding="utf-8"))
version = pkg["version"]

src = root / "dxt-build"
dst = root / f"kaba-{version}.dxt"

if dst.exists():
    dst.unlink()

count = 0
with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
    for p in src.rglob("*"):
        if p.is_file():
            rel = p.relative_to(src).as_posix()
            zf.write(p, rel)
            count += 1

print(f"Wrote {dst} ({dst.stat().st_size:,} bytes, {count} files)")
