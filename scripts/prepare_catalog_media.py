#!/usr/bin/env python3
"""Find openly licensed real photographs on Wikimedia Commons.

Search results are candidates only. An operator must visually inspect each
candidate and check its license before importing it into catalog-media.json.
No credentials are needed or stored.
"""
import argparse
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

API = 'https://commons.wikimedia.org/w/api.php'
USER_AGENT = 'SteelFlowDemo/1.0 (catalog photo attribution; https://github.com/satanick244/telegram-bridge)'
QUERIES = {
    'coil': 'steel coils',
    'galvanized': 'galvanized steel coil',
    'pipe': 'steel pipes stack',
    'rebar': 'rebar',
    'sheet': 'stainless steel sheet',
    'beam': 'steel beams',
    'port': 'container terminal aerial',
}

def request(params):
    url = API + '?' + urllib.parse.urlencode({'format': 'json', 'action': 'query', **params})
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def plain(value):
    return re.sub('<[^>]+>', '', value or '').strip()

def candidates(kind):
    response = request({'generator': 'search', 'gsrnamespace': 6, 'gsrsearch': QUERIES[kind] + ' filetype:bitmap', 'gsrlimit': 10, 'prop': 'imageinfo', 'iiprop': 'url|size|extmetadata|mime', 'iiurlwidth': 1200})
    result = []
    for p in response.get('query', {}).get('pages', {}).values():
        if not p.get('imageinfo'):
            continue
        info = p['imageinfo'][0]
        if info.get('mime') not in ['image/jpeg', 'image/png', 'image/webp']:
            continue
        m = info.get('extmetadata', {})
        value = lambda key: plain(m.get(key, {}).get('value', ''))
        result.append({'title': p['title'], 'width': info['width'], 'height': info['height'], 'url': info['url'], 'thumbnail': info.get('thumburl', info['url']), 'source': info['descriptionurl'], 'author': value('Artist'), 'license': value('LicenseShortName'), 'licenseUrl': value('LicenseUrl'), 'description': value('ImageDescription')[:1000]})
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('kind', choices=QUERIES)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    data = candidates(args.kind)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    print(f'{args.kind}: {len(data)} candidates saved for visual and license review')
