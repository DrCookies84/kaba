import zipfile, sys
z = zipfile.ZipFile("kaba-0.2.0.dxt")
names = z.namelist()
print(f"Total entries: {len(names)}")
print("Top-level files:")
for n in names:
    # Windows-style separators in zip
    if "\\" not in n:
        print(f"  {n}")
print("First-level dirs (sample):")
seen = set()
for n in names:
    top = n.split("\\")[0]
    if top and top not in seen:
        seen.add(top)
        print(f"  {top}/")
# Check icon and manifest
print("\nManifest present:", "manifest.json" in names)
print("Icon present:", "icon.png" in names)
print("server/index.js present:", "server\\index.js" in names)
