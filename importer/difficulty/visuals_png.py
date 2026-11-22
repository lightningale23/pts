"""PNG copies of the visual bonus pictures for ladder.mjs (some Ollama versions can't read WebP).
  pip install pillow && python3 importer/difficulty/visuals_png.py
Writes importer/difficulty/runs/visuals-png/<id>.png (gitignored); ladder.mjs uses them when there."""
import pathlib
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
out = ROOT / 'importer' / 'difficulty' / 'runs' / 'visuals-png'
out.mkdir(parents=True, exist_ok=True)
n = 0
for src in sorted((ROOT / 'data' / 'visuals').glob('*.webp')):
    dst = out / f'{src.stem}.png'
    if not dst.exists():
        Image.open(src).convert('RGB').save(dst)
        n += 1
print(f'{n} pictures converted into {out}')
