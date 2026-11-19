#!/usr/bin/env python3
"""Generate local, content-addressed WebP sizes; preserve original licensed photographs."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
media = json.loads((ROOT / 'src/data/catalog-media.json').read_text())
output = ROOT / 'public/images/optimized'
output.mkdir(parents=True, exist_ok=True)
manifest = {}
for kind, asset in media.items():
    source = ROOT / 'public' / asset['src'].lstrip('/')
    original = source.read_bytes()
    assert hashlib.sha256(original).hexdigest() == asset['sha256'], f'{kind}: original checksum changed'
    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened).convert('RGB')
        widths = sorted({min(w, image.width) for w in (160, 384, 768, 1280)})
        variants = []
        for width in widths:
            height = max(1, round(image.height * width / image.width))
            resized = image.resize((width, height), Image.Resampling.LANCZOS)
            import io
            buffer = io.BytesIO()
            resized.save(buffer, 'WEBP', quality=78, method=6)
            content = buffer.getvalue()
            digest = hashlib.sha256(content).hexdigest()
            filename = f'{kind}-{width}-{digest[:12]}.webp'
            (output / filename).write_bytes(content)
            variants.append({'src': '/images/optimized/' + filename, 'width': width, 'height': height, 'bytes': len(content), 'sha256': digest})
        manifest[kind] = {'original': asset['src'], 'originalSha256': asset['sha256'], 'width': image.width, 'height': image.height, 'variants': variants}
(ROOT / 'src/data/catalog-images.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
original_total = sum((ROOT / 'public' / a['src'].lstrip('/')).stat().st_size for a in media.values())
card_total = sum(next(v['bytes'] for v in a['variants'] if v['width'] >= 384) for a in manifest.values())
print(f'{len(manifest)} photos: originals {original_total:,} bytes; 384px variants {card_total:,} bytes ({1-card_total/original_total:.1%} smaller).')
