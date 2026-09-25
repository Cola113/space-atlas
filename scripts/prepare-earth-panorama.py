"""Build the separated Mauna Kea terrain/cloud layers from saved sources.

No network calls. See public/surface/README.md for the exact source roles.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from landing_texture_lib import sha256, wrap

parser = argparse.ArgumentParser()
parser.add_argument('--terrain', required=True, type=Path)
parser.add_argument('--cloud-source', required=True, type=Path)
parser.add_argument('--prompt', required=True, type=Path)
parser.add_argument('--guide', required=True, type=Path)
parser.add_argument('--material-reference', required=True, type=Path)
parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1]/'public/surface')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)

original = Image.open(args.terrain).convert('RGB')
if original.size != (3840, 1920):
    raise SystemExit(f'Expected inspected source 3840x1920; got {original.size}. Reinspect before processing.')
rgb = np.asarray(original).copy()
h,w = rgb.shape[:2]
solid = rgb.max(axis=2) > 24
boundary = np.argmax(solid, axis=0)
if boundary.min() < h*.50 or boundary.max() > h*.70:
    raise SystemExit('Terrain silhouette no longer matches the inspected open composition.')
rows = np.arange(h)[:, None]
coverage = np.clip((rows-boundary[None, :]+1.5)/3, 0, 1)
coverage = coverage*coverage*(3-2*coverage)
alpha = np.asarray(Image.fromarray(np.uint8(coverage*255)).filter(ImageFilter.GaussianBlur(.55)))
for x,y in enumerate(boundary):
    rgb[:y+1,x] = rgb[min(y+2,h-1),x]
terrain = wrap(Image.fromarray(np.dstack((rgb,alpha))),band=65)
terrain.save(args.output/'earth.webp',quality=94,method=6,exact=True)

# Reuse the observed-in-the-old-generated-image cloud detail, not its mountains.
# The clean patch supplies missing cloud colour only; soft masks preserve all
# available cloud structure. This is texture completion, not new AI generation.
old = np.asarray(Image.open(args.cloud_source).convert('RGB')).astype(np.float32)
if old.shape[:2] != (1920,3840):
    raise SystemExit('Cloud source dimensions changed; reinspect the crop.')
strip = old[944:1092]
patch = Image.fromarray(np.uint8(old[950:1055,1740:2160]))
patch = np.asarray(patch.resize((630,148),Image.Resampling.LANCZOS)).astype(np.float32)
patch = np.asarray(wrap(Image.fromarray(np.uint8(patch)),band=60)).astype(np.float32)
yy,xx = np.indices(strip.shape[:2])
sample_x = (xx+np.sin(yy*.028)*37).astype(int)%patch.shape[1]
fill = patch[yy,sample_x]
valid = (strip[...,2]-strip[...,0]>7)&(strip.min(axis=2)>80)
valid[:5] = False  # omit any residual blue skyline from the old image
weight = np.asarray(Image.fromarray(np.uint8(valid)*255).filter(ImageFilter.GaussianBlur(3))).astype(np.float32)/255
# Erode before feathering so the blend never leaks warm mountain pixels.
safe = Image.fromarray(np.uint8(valid)*255).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.GaussianBlur(2))
weight = np.minimum(weight,np.asarray(safe).astype(np.float32)/255)
completed = strip*weight[...,None]+fill*(1-weight[...,None])
completed = np.roll(completed,-960,axis=1)  # place the richest existing cloud bank toward east
deck = np.asarray(Image.fromarray(np.uint8(completed)).resize((w,330),Image.Resampling.LANCZOS))
cloud_rgb = np.empty((h,w,3),dtype=np.uint8)
start = 948
cloud_rgb[:start] = deck[0]
cloud_rgb[start:start+len(deck)] = deck
cloud_rgb[start+len(deck):] = deck[-1]
cloud_alpha = np.uint8(np.clip((rows-start)/10,0,1)*255).repeat(w,axis=1)
cloud = wrap(Image.fromarray(np.dstack((cloud_rgb,cloud_alpha))),band=90)
cloud.save(args.output/'earth-cloud-sea.webp',quality=94,method=6,exact=True)
(args.output/'earth-prompt.txt').write_text(args.prompt.read_text(encoding='utf-8'),encoding='utf-8')

record_path = args.output/'landings-provenance.json'
if record_path.exists():
    published = json.loads(record_path.read_text(encoding='utf-8'))
    entry = next(entry for entry in published['assets'] if entry['id']=='earth')
    previous = {key:entry[key] for key in ['sourceFile','sourceSha256','sourceDimensions','mode']}
    entry.update({
        'generatedOn':'2026-09-25', 'assetVersion':'earth-separated-open-20260925',
        'mode':'multi-reference redraw: silhouette guide plus volcanic material reference',
        'model':'gpt-image-2.5-sunburst', 'requestedQuality':'high', 'qualityExecutionVerified':False,
        'requestedSize':'4096x2048', 'requestedSizeAccepted':False,
        'sourceFile':'earth-finish-20260925/terrain-original.png',
        'sourceDimensions':list(original.size), 'deliveredDimensions':list(terrain.size),
        'sourceSha256':sha256(args.terrain), 'file':'earth.webp',
        'sha256':sha256(args.output/'earth.webp'), 'bytes':(args.output/'earth.webp').stat().st_size,
        'references':[
            {'role':'composition and low silhouette; local diagram','sha256':sha256(args.guide)},
            {'role':'volcanic material only; previous AI candidate; no preserved pixels','sha256':sha256(args.material_reference)},
        ],
        'processing':'Native 3840x1920 terrain; no upscaling. Black-matte skyline coverage with 3-pixel ramp, subpixel feather and edge colour bleed; longitude seam blend; nadir smoothing; WebP encoding. No clouds, stars, Sun or Moon are baked into terrain. The generated terrain is artistic, not surveyed.',
        'cloudLayerFile':'earth-cloud-sea.webp', 'cloudLayerDimensions':list(cloud.size),
        'cloudLayerSha256':sha256(args.output/'earth-cloud-sea.webp'),
        'cloudLayerBytes':(args.output/'earth-cloud-sea.webp').stat().st_size,
        'cloudSourceSha256':sha256(args.cloud_source),
        'cloudProcessing':'Reuses cloud pixels from the original AI panorama, rows 944:1092. Missing terrain-covered areas completed from a clean same-image cloud patch at (1740,950)-(2160,1055); colour mask eroded and feathered. Rotated 90 degrees, resampled vertically to a 330-pixel band, extended below opaque ground. No new generated detail; independent opaque back layer with a shader horizon fade, depth-dependent drift and twilight tint. Not volumetric clouds or observed weather.',
        'sourceHistory':entry.get('sourceHistory',[previous]),
    })
    published['updatedOn']='2026-09-25'
    record_path.write_text(json.dumps(published,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'terrain':list(terrain.size),'boundaryRange':list(map(int,[boundary.min(),boundary.max()])),
    'partialAlpha':int(((np.asarray(terrain)[...,3]>0)&(np.asarray(terrain)[...,3]<255)).sum())}))
