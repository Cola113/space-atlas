"""Build runtime panoramas for the second landing sites on existing bodies.

Reads saved generation sources and APPENDS to the published provenance record;
it never calls the network and never rewrites the original batch's entries.

    python scripts/prepare-landing-sites.py --sources <source-directory>

The source directory holds the raw provider PNGs. Their 3840x2160 frames are
reparameterized to 3840x1920 exactly like the first batch (see
landing_texture_lib.py), because the provider answers a 2:1 request with 16:9.
"""
import argparse
import json
from datetime import date
from pathlib import Path
from PIL import Image
from landing_texture_lib import panorama_from_frame, sha256

MODEL_NOTE = {
    'model': 'gpt-image-2.5-sunburst',
    'requestedQuality': 'high',
    'requestedSize': '3840x1920',
    'qualityExecutionVerified': False,
}
# Default for the 2026-09-16 batch. A site processed later carries its own date in its
# extra fields, which override this one in the entry below.
GENERATED_ON = '2026-09-16'

# id, source file, mode, processing, extra record fields
SITES = [
    ('moon-farside', 'moon-farside-retry-1.png',
     'reference-edit with same-body material reference',
     'Provider frame 3840x2160 reparameterized to 360x180 at 3840x1920; top-connected black sky removed; '
     'narrow wrap blend; nadir smoothing; WebP encoding. The landscape is a new drawing informed by the '
     'mare floor description of Von Karman crater; the same body\'s published Hadley-Apennine panorama was '
     'attached for regolith colour and grain only, and is not reproduced.',
     {'references': ['public/surface/moon.webp (same body, material character only)'],
      'requestedSizeAccepted': False}),
    ('pluto-charonface', 'pluto-charonface.png',
     'reference-edit with same-body material reference',
     'Provider frame 3840x2160 reparameterized to 360x180 at 3840x1920; top-connected black sky removed; '
     'narrow wrap blend; nadir smoothing; WebP encoding. New drawing; the Sputnik Planitia panorama was '
     'attached for ice colour and grain only, and is not reproduced.',
     {'references': ['public/surface/pluto.webp (same body, material character only)'],
      'requestedSizeAccepted': False}),
    ('mercury-pole', 'mercury-pole.png',
     'reference-edit with same-body material reference',
     'Provider frame 3840x2160 reparameterized to 360x180 at 3840x1920; top-connected black sky removed; '
     'narrow wrap blend; nadir smoothing; WebP encoding. New drawing; the Caloris plains panorama was '
     'attached for regolith colour and tone only, and is not reproduced.',
     {'references': ['public/surface/mercury.webp (same body, material character only)'],
      'requestedSizeAccepted': False}),
    ('io-subjovian', 'io-subjovian.png',
     'reference-edit with same-body material reference',
     'Provider frame 3840x2160 reparameterized to 360x180 at 3840x1920; top-connected black sky removed; '
     'narrow wrap blend; nadir smoothing; WebP encoding. New drawing; the volcanic plain panorama was '
     'attached for sulfur and basalt colour only, and is not reproduced.',
     {'references': ['public/surface/io.webp (same body, material character only)'],
      'requestedSizeAccepted': False}),
    ('europa-subjovian', 'europa-subjovian.png',
     'reference-edit with same-body material reference',
     'Provider frame 3840x2160 reparameterized to 360x180 at 3840x1920; top-connected black sky removed; '
     'narrow wrap blend; nadir smoothing; WebP encoding. New drawing; the sub-Jovian ice field panorama was '
     'attached for ice colour and fracture tone only, and is not reproduced.',
     {'references': ['public/surface/europa.webp (same body, material character only)'],
      'requestedSizeAccepted': False}),
    ('mars-phoenix', 'mars-phoenix.png',
     'multi-reference edit: observed Phoenix panorama for ground pattern, same-body panorama for material',
     'Provider frame 3840x2160 reparameterized to 360x180 at 3840x1920; top-connected black sky removed; '
     'narrow wrap blend; nadir smoothing; WebP encoding. New drawing. NASA PIA13804, the real full-circle '
     'Phoenix panorama of this landing area, supplied the polygonal ground pattern and flat horizon; the '
     'same body\'s Gediz Vallis panorama supplied Mars soil colour and tone. Lander deck, solar panels, '
     'meteorology mast and arm trenches visible in the photograph were not reproduced, and no pixel of '
     'either input is preserved.',
     {'references': ['NASA/JPL-Caltech/University of Arizona PIA13804 (ground pattern, observed)',
                     'public/surface/mars.webp (same body, material character only)'],
      'requestedSizeAccepted': False}),
    ('charon', 'charon.png',
     'text-to-image',
     'Complete 3840x2160 generated panorama reparameterized to 360x180 at 3840x1920; top-connected black '
     'sky removed; narrow wrap blend; nadir smoothing; WebP encoding. No reference image was supplied.',
     {'requestedSizeAccepted': False}),
    ('venus', 'venus.png',
     'reference-edit with the observed Venera 13 landing panorama',
     'Provider frame 3840x2160 reparameterized to 360x180 at 3840x1920; top-connected black sky removed; '
     'narrow wrap blend; nadir smoothing; WebP encoding. New drawing. The real Venera 13 colour panorama of '
     'this landing area (7.5S, 303E, east of Phoebe Regio) supplied the flat layered rock slabs, the dark '
     'soil with angular gravel and the warm ochre tone; that frame spans only about 40 degrees vertically, '
     'so the ground below it, which the probe never photographed, continues the same material and no new '
     'landform type is introduced. Lander hardware in the photograph (toothed rim, disc lens cap, striped '
     'ranging rod, antenna) was not reproduced, and no pixel of the input is preserved.',
     {'references': ['Venera 13 lander colour panorama, USSR/NASA, public domain (ground character, observed)'],
      'requestedSizeAccepted': False}),
    ('ceres', 'ceres-occator.png',
     'reference-edit with a Dawn orbiter mosaic of the same feature',
     'Source frame is already 3840x1920, the requested 2:1, so unlike every earlier site it is NOT '
     'reparameterized from 16:9; top-connected black sky removed; narrow wrap blend; nadir smoothing; '
     'WebP encoding. New drawing. The Dawn mosaic PIA21924 (Cerealia Facula at about 19.7N, 239.6E) and '
     'PIA24021 supplied the white-to-pale-yellow salt crust tone, its fractured structure, the dark '
     'gray-brown crater-floor regolith and the contrast between them; the top-down spacecraft viewpoint, '
     'framing, false-colour treatment and lighting of those images were not copied, and no pixel of the '
     'input is preserved. Standing height, side view of the deposit.',
     {'references': ['NASA/JPL-Caltech/UCLA/MPS/DLR/IDA PIA21924 (material and landform character)',
                     'NASA/JPL-Caltech/UCLA/MPS/DLR/IDA PIA24021 (salt/regolith contrast, false colour)'],
      # This batch was generated on 2026-09-19; the earlier sites keep 2026-09-16.
      'generatedOn': '2026-09-19',
      'requestedSizeAccepted': True}),
]

parser = argparse.ArgumentParser()
parser.add_argument('--sources', type=Path, required=True)
parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'public/surface')
# Processing one site later does not mean the earlier sources are still on disk, and
# the entries for them are already published, so allow selecting the ones to rebuild.
parser.add_argument('--only', help='comma-separated site ids; default is every site in SITES')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)

selected = set(args.only.split(',')) if args.only else None
known = {site[0] for site in SITES}
if selected is not None and not selected <= known:
    raise SystemExit(f'--only names unknown sites: {sorted(selected - known)}')

record_path = args.output / 'landings-provenance.json'
published = json.loads(record_path.read_text(encoding='utf-8'))
records = published['assets']
by_id = {entry['id']: index for index, entry in enumerate(records)}

for site_id, filename, mode, processing, extra in SITES:
    if selected is not None and site_id not in selected:
        continue
    source = args.sources / 'raw' / filename
    image = panorama_from_frame(source)
    dest = args.output / f'{site_id}.webp'
    image.save(dest, quality=91, method=6, exact=True)
    entry = {
        'id': site_id,
        'generatedOn': GENERATED_ON,
        'mode': mode,
        'sourceFile': filename,
        'sourceDimensions': list(Image.open(source).size),
        'deliveredDimensions': list(image.size),
        'sourceSha256': sha256(source),
        'file': dest.name,
        'sha256': sha256(dest),
        'bytes': dest.stat().st_size,
        'processing': processing,
        **MODEL_NOTE, **extra,
    }
    if site_id in by_id:
        records[by_id[site_id]] = entry
    else:
        records.append(entry)
    print(f'{site_id}: {image.size}, {entry["bytes"]} bytes', flush=True)

published['updatedOn'] = date.today().isoformat()
record_path.write_text(json.dumps(published, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
