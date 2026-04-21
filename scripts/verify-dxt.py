"""Sanity-check a packed .dxt: manifest, icon, and server entry point present.

ZIP format uses forward slashes per APPNOTE.TXT regardless of host OS, so
checks use POSIX-style paths.
"""
import sys
import zipfile

path = sys.argv[1] if len(sys.argv) > 1 else "kaba-0.2.3.dxt"
z = zipfile.ZipFile(path)
names = z.namelist()

print(f"File: {path}")
print(f"Total entries: {len(names)}")

top_level = sorted({n.split("/")[0] for n in names if "/" in n} | {n for n in names if "/" not in n})
print("Top-level entries:")
for t in top_level:
    print(f"  {t}")

required = [
    ("manifest.json", "manifest.json"),
    ("icon.png", "icon.png"),
    ("server/index.js", "server/index.js"),
]
print()
missing = False
for label, n in required:
    present = n in names
    print(f"{label}: {'ok' if present else 'MISSING'}")
    if not present:
        missing = True

sys.exit(1 if missing else 0)
