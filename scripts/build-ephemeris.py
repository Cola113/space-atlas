"""Extract original JPL Chebyshev records into independently loadable years.

Setup: python -m venv --system-site-packages data/ephemeris-tools
       data/ephemeris-tools/Scripts/python -m pip install jplephem==2.24
Run:   data/ephemeris-tools/Scripts/python scripts/build-ephemeris.py

Raw SPK excerpts and HTTP ranges stay in ignored data/. Published coefficients
retain the original polynomial degree and time interval. Float32 is used only
when the all-times quantization bound is < 0.1 km per track; otherwise Float64.
This bounds encoding error, not the accuracy of JPL's physical orbit solution.
"""
import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
import struct

import numpy as np
import requests
from jplephem.daf import DAF
from jplephem.spk import SPK
from jplephem.excerpter import write_excerpt

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'data' / 'jpl'
DEST = ROOT / 'public' / 'ephemeris'
BASE = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/satellites/'
SOURCES = {
    'saturn': ('sat441.bsp', {602, 606, 699}),
    'uranus': ('ura184_part-3.bsp', {705, 799}),
    'pluto': ('plu060.bsp', {9, 10, 901, 999}),
}
J2000 = datetime(2000, 1, 1, 12, tzinfo=timezone.utc)


def epoch(year):
    # Calendar label interpreted as TDB, not a UTC-to-TDB conversion.
    return (datetime(year, 1, 1, tzinfo=timezone.utc) - J2000).total_seconds()


class RangeFile:
    """Read only required HTTP ranges, with a validated on-disk block cache."""
    BLOCK = 256 * 1024

    def __init__(self, url):
        self.url = url
        self.offset = 0
        self.directory = CACHE / (url.rsplit('/', 1)[1] + '.ranges')
        self.directory.mkdir(parents=True, exist_ok=True)
        self.session = requests.Session()

    def seek(self, offset, whence=0):
        if whence != 0:
            raise ValueError('Only absolute seeks supported')
        self.offset = offset

    def read(self, size):
        output = bytearray()
        while size:
            start = (self.offset // self.BLOCK) * self.BLOCK
            path = self.directory / str(start)
            if path.exists():
                data = path.read_bytes()
            else:
                end = start + self.BLOCK - 1
                response = self.session.get(self.url, headers={'Range': f'bytes={start}-{end}', 'Accept-Encoding': 'identity'}, timeout=45)
                response.raise_for_status()
                cr = response.headers.get('Content-Range', '')
                if response.status_code != 206 or not cr.startswith(f'bytes {start}-'):
                    raise RuntimeError(f'Server did not honor the SPK byte range: {response.status_code} {cr}')
                data = response.content
                returned_end = int(cr.split('/')[0].split('-')[1])
                if len(data) != returned_end - start + 1:
                    raise RuntimeError('Truncated SPK range')
                path.write_bytes(data)
            offset = self.offset - start
            count = min(size, len(data) - offset)
            if count <= 0:
                raise EOFError('SPK range exceeded file')
            output.extend(data[offset:offset + count])
            self.offset += count
            size -= count
        return bytes(output)

    def close(self):
        self.session.close()


def excerpt(system, filename, targets):
    path = CACHE / (system + '-1899-2101.bsp')
    if path.exists():
        return path
    print(f'Extracting {filename}: targets {sorted(targets)}', flush=True)
    remote = RangeFile(BASE + filename)
    source = SPK(DAF(remote))
    summaries = [summary for summary, segment in zip(source.daf.summaries(), source.segments) if segment.target in targets]
    found = {descriptor[2] for _, descriptor in summaries}
    if found != targets:
        raise RuntimeError(f'Missing targets: {targets - found}')
    pending = path.with_suffix('.partial')
    with pending.open('w+b') as stream:
        write_excerpt(source, stream, 2451545 + (epoch(1900) - 86400) / 86400,
                      2451545 + (epoch(2101) + 86400) / 86400, summaries)
    source.close()
    pending.replace(path)
    print(f'{system}: {path.stat().st_size / 1048576:.2f} MiB extracted', flush=True)
    return path


def build(system, filename, path, first, last):
    kernel = SPK.open(path)
    tracks = []
    for segment in kernel.segments:
        if segment.frame != 1 or segment.data_type not in (2, 3):
            raise ValueError('Expected original J2000 SPK type 2/3 records')
        initial_jd, interval_days, coefficients = segment.load_array()
        coefficients = np.moveaxis(coefficients[:3], 0, 1)  # record / xyz / ascending degree
        quantized = coefficients.astype('<f4')
        # |T_n(x)| <= 1 throughout [-1,1]. Triangle inequality gives a
        # conservative bound for every time in every original record.
        bound = float(np.max(np.linalg.norm(np.sum(np.abs(coefficients - quantized), axis=2), axis=1)))
        precision = 4 if bound < .1 else 8
        tracks.append({
            'target': segment.target, 'center': segment.center,
            'initial': (initial_jd - 2451545) * 86400,
            'interval': interval_days * 86400,
            'degree': coefficients.shape[2] - 1,
            'precision': precision, 'encodingBoundKm': bound if precision == 4 else 0,
            'coefficients': coefficients.astype('<f4' if precision == 4 else '<f8'),
            'segment': segment,
        })
    directory = DEST / system
    directory.mkdir(parents=True, exist_ok=True)
    files, fixtures = {}, []
    for year in range(first, last + 1):
        start, end = epoch(year) - 86400, epoch(year + 1) + 86400
        payload, metadata = bytearray(), []
        for track in tracks:
            i = max(0, math.floor((start - track['initial']) / track['interval']))
            j = min(len(track['coefficients']), math.floor((end - track['initial']) / track['interval']) + 1)
            if j <= i:
                continue  # Kernels can split a target into multiple date segments.
            data = track['coefficients'][i:j]
            payload.extend(b'\0' * ((-len(payload)) % 8))
            info = {key: value for key, value in track.items() if key not in ('coefficients', 'segment')}
            info.update(initial=track['initial'] + i * track['interval'], count=j-i, offset=len(payload))
            metadata.append(info)
            payload.extend(data.tobytes())
            # Independent evaluator in jplephem supplies test vectors at the
            # year boundaries and a non-midpoint epoch; JS must reproduce them.
            for t in (epoch(year), epoch(year) + 123456.789, epoch(year + 1)):
                if not (track['initial'] <= t <= track['initial'] + len(track['coefficients']) * track['interval']):
                    continue
                expected = track['segment'].compute(2451545, t / 86400)[:3]
                fixtures.append({'system': system, 'year': year, 'target': track['target'], 'center': track['center'], 'tdbSeconds': t, 'positionKm': expected.tolist()})
        for target in SOURCES[system][1]:
            intervals = sorted((t['initial'], t['initial'] + t['count'] * t['interval']) for t in metadata if t['target'] == target)
            covered = start
            for lo, hi in intervals:
                if lo > covered:
                    raise ValueError(f'{system}/{year}/{target}: gap in source coverage')
                covered = max(covered, hi)
            if covered < end:
                raise ValueError(f'{system}/{year}/{target}: incomplete source coverage')
        header = json.dumps({'version': 1, 'system': system, 'year': year, 'frame': 'J2000', 'timescale': 'TDB', 'units': 'km', 'tracks': metadata}, separators=(',', ':')).encode()
        header += b' ' * ((-len(header)) % 8)
        content = b'ATLEPH01' + struct.pack('<II', len(header), len(payload)) + header + payload
        name = f'{year}.bin'
        (directory / name).write_bytes(content)
        files[str(year)] = {'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
    result = {
        'source': BASE + filename, 'excerptSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'tracks': [{k: v for k, v in t.items() if k not in ('coefficients', 'segment')} for t in tracks],
        'files': files,
    }
    kernel.close()
    print(f'{system}: {sum(f["bytes"] for f in files.values()) / 1048576:.2f} MiB published; maximum track encoding bound {max(t["encodingBoundKm"] for t in tracks):.6f} km', flush=True)
    return result, fixtures


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--download-only', action='store_true')
    parser.add_argument('--system', choices=list(SOURCES))
    parser.add_argument('--first', type=int, default=1900)
    parser.add_argument('--last', type=int, default=2100)
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    DEST.mkdir(parents=True, exist_ok=True)
    sources, fixtures = {}, []
    for system, (filename, targets) in SOURCES.items():
        if args.system and args.system != system:
            continue
        path = excerpt(system, filename, targets)
        if not args.download_only:
            sources[system], reference = build(system, filename, path, args.first, args.last)
            fixtures.extend(reference)
    if not args.download_only:
        suffix = f'-{args.system}' if args.system else ''
        (DEST / f'manifest{suffix}.json').write_text(json.dumps({'version': 1, 'fromYear': args.first, 'throughYear': args.last, 'generatedWith': 'jplephem 2.24', 'sources': sources}, indent=2), encoding='utf-8')
        (ROOT / 'solar-system' / 'tests' / f'ephemeris-reference{suffix}.json').write_text(json.dumps(fixtures, separators=(',', ':')), encoding='utf-8')


if __name__ == '__main__':
    main()
