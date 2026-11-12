"""Regenerate the local extension icons (requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

out = Path(__file__).resolve().parents[1] / 'extension' / 'icons'
out.mkdir(parents=True, exist_ok=True)
size = 512
image = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((8, 8, 504, 504), radius=118, fill=(0, 92, 91, 255))
white = (255, 255, 255, 255)
draw.line((158, 354, 354, 158), fill=white, width=45)
draw.line((214, 158, 354, 158, 354, 298), fill=white, width=45, joint='curve')
for dimension in (16, 32, 48, 128):
    image.resize((dimension, dimension), Image.Resampling.LANCZOS).save(out / f'icon-{dimension}.png')
