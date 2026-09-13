"""Adopt NASA catalog periods separately from the JPL mean-element epoch.

Input: four original NASA HTML snapshots in ignored data/science-audit/.
These are nominal periods for an illustrative fixed ellipse, not new fitted
ephemerides. Irregular outer satellites retain the more recent JPL averages.
"""
from pathlib import Path
from html.parser import HTMLParser
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]


class Tables(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.cells, self.cell = [], None, None

    def flush(self):
        if self.cell is not None:
            self.cells.append(re.sub(r'\s+', ' ', self.cell).strip())
            self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self.cells = []
        if tag in ('td', 'th') and self.cells is not None:
            self.flush()  # NASA's HTML sometimes omits closing td tags.
            self.cell = ''

    def handle_data(self, text):
        if self.cell is not None:
            self.cell += text

    def handle_endtag(self, tag):
        if tag in ('td', 'th'):
            self.flush()
        if tag == 'tr' and self.cells is not None:
            self.flush()
            self.rows.append(self.cells)
            self.cells = None


def main():
    path = ROOT / 'solar-system/src/physics/body-definitions.json'
    registry = json.loads(path.read_text(encoding='utf-8'))
    retained = {'himalia', 'phoebe', 'nereid'}
    adopted = []
    for system in ['jovian', 'saturnian', 'uranian', 'neptunian']:
        source = ROOT / f'data/science-audit/{system}-facts.html'
        raw = source.read_bytes()
        source_id = f'nasa-{system}-periods'
        registry['sources'][source_id] = {
            'url': f'https://nssdc.gsfc.nasa.gov/planetary/factsheet/{system}satfact.html',
            'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
            'retrieved': '2026-09-14',
            'reference': 'NASA NSSDCA Satellite Fact Sheet, Orbital parameters / Orbital Period (days)',
        }
        table = Tables()
        table.feed(raw.decode('utf-8'))
        for row in table.rows:
            if len(row) != 7 or not row[0]:
                continue
            name = row[0].split()[0].lower()
            if name not in registry['bodies'] or name in retained:
                continue
            orbit = registry['bodies'][name]['orbit']
            if orbit['source'] != 'satellite-elements':
                raise ValueError(f'Unexpected element source for {name}')
            # R describes retrograde motion; inclination already specifies it.
            period = float(row[3].removesuffix('R'))
            orbit.update({
                'periodDays': period, 'periodSource': source_id,
                'periodType': 'nominal orbital period (NASA catalog summary)',
                'periodEpochTdbJd': None,
                'periodValidity': 'NASA 目录公转周期摘要，未给独立历元或误差；不视为 JPL 元素历元的拟合平均运动。固定椭圆以此近似传播，不用于绝对相位或交会预报。',
            })
            adopted.append(name)
    if len(adopted) != 29 or len(set(adopted)) != 29:
        raise ValueError(f'Expected 29 unique satellite periods, got {adopted}')
    for body in registry['bodies'].values():
        orbit = body['orbit']
        if 'periodDays' in orbit:
            orbit.setdefault('periodSource', orbit['source'])
            orbit.setdefault('periodEpochTdbJd', orbit.get('epochTdbJd'))
            orbit.setdefault('periodValidity', '所列来源的参考周期；保留该来源的定义与平均模型限制，不是任意观测日期的瞬时周期。')
    path.write_text(json.dumps(registry, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Adopted {len(adopted)} NASA nominal periods; retained independent rotation models.')


if __name__ == '__main__':
    main()
