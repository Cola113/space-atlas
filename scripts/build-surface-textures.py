from pathlib import Path
import json
import argparse
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

parser = argparse.ArgumentParser(description='Prepare surface panoramas; requires Pillow and numpy. No image API calls.')
parser.add_argument('--moon',type=Path,required=True,help='Original JSC2007e045379.jpg')
parser.add_argument('--europa',type=Path,required=True,help='Saved 3840x2160 generated ice panorama')
parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'public/surface')
args=parser.parse_args()
DEST=args.output
DEST.mkdir(parents=True, exist_ok=True)

def cut_sky(image):
    pixels = np.asarray(image.convert('RGB')).copy()
    dark = np.max(pixels, axis=2) < 24
    mask = Image.fromarray((dark*255).astype(np.uint8))
    small = mask.resize((2048,round(mask.height*2048/mask.width)),Image.Resampling.NEAREST)
    ImageDraw.floodfill(small,(0,0),128)
    sky = (np.asarray(small.resize(mask.size,Image.Resampling.NEAREST)) == 128) & dark
    rgba = np.concatenate([pixels, ((~sky)*255).astype(np.uint8)[:,:,None]], axis=2)
    rgba[sky,:3] = 0
    return Image.fromarray(rgba)

def wrap_seam(image, band):
    # Match both wrap edges; limit correction to the back-facing seam.
    arr = np.asarray(image).astype(np.float32)
    average = (arr[:,0] + arr[:,-1])*.5
    left, right = arr[:,0].copy(), arr[:,-1].copy()
    for x in range(band):
        weight = (1-x/band)**2
        arr[:,x] += (average-left)*weight
        arr[:,-1-x] += (average-right)*weight
    return Image.fromarray(np.clip(arr,0,255).astype(np.uint8))

moon = Image.open(args.moon).convert('RGB')
width, height = 8192,4096
strip_h = round(moon.height * width / moon.width)
strip = cut_sky(moon.resize((width,strip_h),Image.Resampling.LANCZOS))
start = height//2 - round(820*width/moon.width)
end = start+strip_h
canvas = Image.new('RGBA',(width,height),(0,0,0,0))
# The Apollo panorama is a narrow cylindrical strip. Only the missing nadir is
# extended from a ground-only photographic patch; it is not measured terrain.
ground_h=height-end+200
rng=np.random.default_rng(15015)
soil=np.asarray(moon.crop((2200,1470,2280,1550)).convert('L'),dtype=np.float32)
# Synthesize only unrecorded ground. Match photographic grain statistics,
# avoiding mirrored rover tracks and repetitive large-scale image features.
grain=np.zeros((ground_h,width),dtype=np.float32)
for step,strength in [(2,8),(8,7),(32,3),(128,2)]:
    noise=np.clip(rng.normal(128,35,(max(2,ground_h//step),width//step)),0,255).astype(np.uint8)
    noise[:,-1]=noise[:,0]
    field=np.asarray(Image.fromarray(noise).resize((width,ground_h),Image.Resampling.BICUBIC),dtype=np.float32)
    grain+=(field-128)/35*strength
tone=float(np.median(np.asarray(strip)[-40:,:,:3]))
grain=np.clip(tone+grain*(min(float(soil.std()),18)/14),0,255).astype(np.uint8)
ground=Image.fromarray(grain).convert('RGBA')
canvas.paste(ground,(0,end-200))
canvas.paste(strip,(0,start))
arr=np.asarray(canvas).copy()
fill=np.asarray(ground)
for y in range(200):
    t=(y/199)**2*(3-2*y/199)
    arr[end-200+y,:,:3] = (arr[end-200+y,:,:3]*(1-t)+fill[y,:,:3]*t).astype(np.uint8)
# Compress texture variation at the polar singularity to avoid a pinwheel.
for y in range(height-280,height):
    t=((y-(height-280))/279)**2
    arr[y,:,:3] = (arr[y,:,:3]*(1-t)+np.mean(arr[y,:,:3],axis=0)*t).astype(np.uint8)
moon_out=wrap_seam(Image.fromarray(arr),120)
moon_out.save(DEST/'moon.webp',quality=89,method=6)
moon_out.resize((4096,2048),Image.Resampling.LANCZOS).save(DEST/'moon-4k.webp',quality=89,method=6)

europa = Image.open(args.europa).convert('RGB')
# The provider returned 3840x2160 for a 3840x1920 request. This is an explicit
# projection adaptation, not a claim that the source is native 2:1.
europa = cut_sky(europa.resize((3840,1920),Image.Resampling.LANCZOS))
europa_out = wrap_seam(europa,140)
europa_out.save(DEST/'europa.webp',quality=91,method=6)
for name in ['moon','moon-4k','europa']:
    image=Image.open(DEST/f'{name}.webp')
    print(json.dumps({'file':str(DEST/f'{name}.webp'),'size':image.size,'bytes':(DEST/f'{name}.webp').stat().st_size}))
