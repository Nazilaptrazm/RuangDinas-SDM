"""Prepare frontend assets in Vercel's public directory from root-level sources."""
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
PUBLIC.mkdir(exist_ok=True)

for filename in ("index.html", "app.js", "style.css"):
    shutil.copy2(ROOT / filename, PUBLIC / filename)

if not (ROOT / "sppd.db").is_file():
    raise SystemExit("sppd.db wajib disertakan untuk mengisi PostgreSQL deployment pada inisialisasi pertama.")

print("Frontend assets copied to public/ for Vercel.")
