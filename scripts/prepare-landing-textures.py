"""Build runtime panoramas from saved sources. No network or generation calls."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

Image.MAX_IMAGE_PIXELS = 300_000_000
parser = argparse.ArgumentParser()
parser.add_argument('--sources', type=Path, required=True)
parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1]/'public/surface')
parser.add_argument('--mars-only', action='store_true')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
records = []
if args.mars_only:
    records=[entry for entry in json.loads((args.output/'landings-provenance.json').read_text(encoding='utf-8'))['assets'] if entry['id']!='mars']

def wrap(image, band=70):
    a = np.asarray(image).astype(np.float32)
    edge = (a[:, 0] + a[:, -1])*.5
    left, right = a[:, 0].copy(), a[:, -1].copy()
    for x in range(band):
        weight = (1-x/band)**2
        a[:, x] += (edge-left)*weight
        a[:, -1-x] += (edge-right)*weight
    # Fade only the last few degrees of ground to avoid a polar pinwheel.
    for y in range(image.height-60, image.height):
        t=((y-image.height+60)/59)**2
        a[y,:,:3]=a[y,:,:3]*(1-t)+a[y,:,:3].mean(axis=0)*t
    return Image.fromarray(np.uint8(np.clip(a,0,255)))

def remove_black_sky(image):
    a=np.asarray(image.convert('RGB')).copy()
    black=a.max(axis=2)<26
    mask=Image.fromarray(np.uint8(black)*255).copy()
    ImageDraw.floodfill(mask,(0,0),128)
    sky=np.asarray(mask)==128
    alpha=np.uint8(~sky)*255
    a[sky]=0
    return Image.fromarray(np.dstack([a,alpha]))

def record(source, image, id, mode, processing):
    dest=args.output/f'{id}.webp'
    image.save(dest,quality=91,method=6,exact=True)
    records.append({'id':id,'mode':mode,'sourceDimensions':list(Image.open(source).size),
        'deliveredDimensions':list(image.size),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'file':dest.name,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),'bytes':dest.stat().st_size,
        'processing':processing})
    print(f'{id}: {image.size}, {dest.stat().st_size} bytes',flush=True)

for id in ([] if args.mars_only else ['io','titan','enceladus','pluto','miranda','mercury']):
    source=args.sources/'raw'/f'{id}.png'
    original=Image.open(source).convert('RGB')
    # The provider rendered a complete panorama into 16:9. Re-map its vertical
    # angular coordinate explicitly, retaining the complete ground and zenith.
    image=remove_black_sky(original.resize((3840,1920),Image.Resampling.LANCZOS))
    image=wrap(image)
    record(source,image,id,'text-to-image',
        'Complete 3840x2160 generated panorama reparameterized to 360x180 at 3840x1920; top-connected black sky removed; narrow wrap blend; nadir smoothing; WebP encoding.')
    records[-1].update(model='gpt-image-2.5-sunburst',requestedQuality='high',requestedSize='3840x1920',
        qualityExecutionVerified=False)

source=args.sources/'mars-source.jpg'
original=Image.open(source).convert('RGB')
w,h=8192,4096
scale=w/original.width
strip=original.resize((w,round(original.height*scale)),Image.Resampling.LANCZOS)
a=np.asarray(strip).copy()
row,col=np.indices(a.shape[:2])
# Trace the distant skyline in the 1920 px source preview. Color thresholds
# confuse the warm sky with pale sediment and remove real rock faces.
skyline_points=[(0,60),(35,55),(80,52),(130,50),(170,53),(210,62),(250,76),
    (285,91),(330,101),(380,111),(425,122),(470,130),(505,145),(540,166),
    (562,171),(580,159),(605,151),(625,155),(650,169),(681,181),(704,184),
    (724,181),(749,174),(765,175),(791,182),(827,187),(848,186),(862,180),
    (877,182),(891,190),(916,180),(928,184),(962,172),(986,159),(1009,143),
    (1034,134),(1069,120),(1110,108),(1154,98),(1200,91),(1260,85),
    (1300,82),(1350,80),(1390,82),(1450,85),(1520,89),(1580,89),
    (1630,95),(1680,96),(1720,104),(1750,111),(1783,113),(1810,104),
    (1840,87),(1870,77),(1896,67),(1920,61)]
skyline=np.interp(np.arange(w)*1920/w,*np.array(skyline_points).T)*w/1920
alpha=np.uint8(np.clip(row-skyline[None,:],0,1)*255)
alpha[a.max(axis=2)<12]=0
start=h//2-round(strip.height*.29)
canvas=np.zeros((h,w,4),dtype=np.uint8)
end=min(h,start+strip.height)
canvas[start:end]=np.dstack([a,alpha])[:end-start]

# The raw mosaic has missing near-ground and partial rover panels. Keep the
# upper photographic terrain and blend to reference-generated sediment below
# a varying boundary before those panels. The photograph remains untouched
# above the blend, apart from projection, skyline masking and edge processing.
boundary=np.interp(np.arange(w)/w,[0,.12,.25,.4,.55,.61,.65,.8,.90,.94,1],
    np.array([.45,.49,.62,.69,.64,.47,.45,.45,.31,.29,.45])*strip.height)+start
filled=canvas.copy()
fill_source=args.sources/'raw/mars-fill.png'
fill_original=Image.open(fill_source).convert('RGB')
# The edit kept the reference's pixel-scale horizon and extended the bottom
# from 1920 to 2160. Crop that extension before aligning the two inputs.
fill_image=fill_original.crop((0,0,3840,1920)).resize((w,h),Image.Resampling.LANCZOS)
fill_pixels=np.asarray(fill_image)
generated_edge=np.argmax(fill_pixels.max(axis=2)>26,axis=0)
# The edit cleans the photographic sky slivers. Use its continuous silhouette
# conservatively with the traced photograph; never seek unrelated rock edges
# using a per-column maximum gradient, which would create rectangular holes.
edge=np.maximum(skyline+start,generated_edge)+w/1920*3
canvas[:,:,3]=np.uint8(np.clip(np.arange(h)[:,None]-edge[None,:],0,1)*255)
filled=canvas.copy()
for y in range(start,h):
    blend=np.clip((y-boundary+90)/160,0,1)
    blend=blend*blend*(3-2*blend)
    fill=fill_pixels[y]
    filled[y,:,:3]=canvas[y,:,:3]*(1-blend[:,None])+fill*blend[:,None]
    filled[y,:,3]=np.maximum(canvas[y,:,3],np.uint8(blend*255))
image=wrap(Image.fromarray(filled),100)
record(source,image,'mars','NASA photographic mosaic with multi-image AI missing-ground fill',
    'PIA26410 (341 Mastcam frames, 2024-09-21/22, Earth white balance); approximate cylindrical/equirectangular projection, traced skyline combined conservatively with reference-edit silhouette; observed upper terrain preserved through local compositing, missing near-ground/rover region blended with multi-image reference-generated sediment. Fill response cropped from 3840x2160 to 3840x1920 to match reference pixel-scale framing, then resampled; wrap and nadir blend. Approximate heading, not survey geometry.')
records[-1].update(model='gpt-image-2.5-sunburst',requestedQuality='high',qualityExecutionVerified=False,
    requestedSize='3840x1920',fillSourceDimensions=list(fill_original.size),
    fillSourceSha256=hashlib.sha256(fill_source.read_bytes()).hexdigest(),
    referenceInputs=['3840x1920 prepared composition with temporary near-ground fill','1920x541 PIA26410 photographic mosaic preview'])
image.resize((4096,2048),Image.Resampling.LANCZOS).save(args.output/'mars-4k.webp',quality=89,method=6,exact=True)
(args.output/'landings-provenance.json').write_text(json.dumps({'generatedOn':'2026-09-12','assets':records},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
