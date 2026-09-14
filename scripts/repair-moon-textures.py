"""Prepare and composite the six reviewed moon texture repairs; never calls an API."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import cv2
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
TEXTURES = ROOT / 'public/solar-system/textures'
SOURCES = {
    'triton': 'completed/triton-3840.webp',
    'iapetus': '4k_iapetus.jpg',
    'charon': 'completed/charon-3840.webp',
    'rhea': '4k_rhea.jpg',
    'mimas': '4k_mimas.jpg',
    'callisto': 'completed/callisto-3840.webp',
}
DESCRIPTIONS = {
    'triton': '''Triton, Neptune's icy moon. Reference 1 is the current defective completed map, for coordinate registration only. Reference 2 is the original Voyager-derived map: its BLACK area is missing imagery, not dark terrain. The interior of the observed patch is the highest-priority terrain and color reference. Preserve its identifiable terrain in place. Continue its pale nitrogen frost, subdued pink-gray ice, green-gray plains and gently cellular cantaloupe terrain naturally outside that footprint. Remove the eye-shaped outline of the old source footprint: extend each terrain type across that outline, not a ring of uniform transition color. No enclosing oval, glowing eye, vignette, giant crater or abrupt change in texture frequency along the source footprint. Bright southern frost is real, but the boundary of the photograph is not a geological boundary. Do not invent dense lunar cratering. The unobserved terrain is explicitly artistic reconstruction.''',
    'iapetus': '''Iapetus, Saturn's strongly two-toned icy moon. Reference 1 provides geographic registration: retain the bright cratered hemisphere on the left, dark Cassini Regio on the right, the irregular speckled boundary and brighter high latitudes, with the large southern basin in place. The dark region is REAL low-albedo terrain, not missing coverage, and must remain dramatically darker than the ice. Repair the smeared cloned patches and panel boundaries, especially inside the dark region and near the poles. Make the dark reddish charcoal terrain readable through subtle crater rims, regolith and the equatorial ridge, without bleaching it gray or making it glow. Use restrained open shadows and low-contrast fine terrain under uniform ambient illumination. Do not paint a night hemisphere or black void. The albedo contrast is more important than uniform brightness. This is a reference-based artistic reconstruction, not new Cassini data.''',
    'charon': '''Charon, Pluto's moon. Reference 1 is the current completed texture with an excessively black hard strip along the north pole. Reference 2 is the original New Horizons-derived texture and has priority for the central mapped terrain and diagonal canyon's position. Keep the mapped central terrain, canyon and craters registered in place. Repair the top 20 percent: the real north polar dark red-brown deposit must remain visible, but remove the nearly black straight latitude band, replace the sharp band edge with an irregular geological transition, retain fine subtle terrain in the cap and make it converge naturally at the pole. Do not turn the cap into a bright ice cap. Reconcile source footprint transitions without adding an oval edge or new large basins. The colors are predominantly neutral gray with a subdued rusty north polar cap. No uniform black row, posterization, horizontal dark ribbon or spotlight.''',
    'rhea': '''Rhea, Saturn's ancient cratered ice moon. Reference 1 provides its broad terrain distribution, large basin locations and faint bright tectonic wisps. Repair the severe discontinuity between the far left and far right longitude edges and replace the broad smeared, stretched, softly cloned terrain with coherent irregular impact cratering of varied sizes, gently worn ice plains and subtle fracture traces. Retain the large recognizable terrain positions. Craters should be distinct, varied and moderately contrasted, not thick black holes or uniformly embossed beads. Use neutral cool gray ice, removing the artificial yellow-green stain and inconsistent mosaic illumination. Keep all regions equally resolved, including poles; represent correct equirectangular polar stretching, not dragged pixels. No giant new crater dominating the hemisphere. This is a reference-based artistic reconstruction and does not claim new observed detail.''',
    'mimas': '''Mimas, Saturn's small densely cratered ice moon. Reference 1 provides coordinate registration and the essential landmark: preserve the large Herschel impact crater at approximately x=0.68, y=0.51 with approximately 0.17 canvas-width diameter, its raised rim and central peak. Do not move, multiply or erase Herschel. Repair the discontinuity between left and right longitude edges, the broad smeared polar regions and the rectangular mosaic seams. Make the smaller densely packed craters coherent and variable in size while retaining subdued gray water ice and the relative terrain placement. Remove the yellow-blue mosaic lighting casts and black crushed shadows. Fine terrain should look naturally eroded and resolved, not oversharpened embossed noise. Full-map reference reconstruction, not a photograph or a globe rendering.''',
    'callisto': '''Callisto, Jupiter's old heavily cratered moon. Reference 1 is the current completed map with vertical AI/source panel boundaries. Reference 2 is the original Voyager/Galileo-derived map: it has priority for the registered multi-ring impact basin around x=0.35,y=0.41 and actual clear crater fields; its bright blurry vertical strip around x=0.70 is poor mosaic fill, not a real terrain stripe. Repair the vertical joins particularly around x=0.20-0.26 and x=0.62-0.75, and the outer longitude wrap. Continue crater density, scale, brightness and coloration across those strips, without painting another continuous vertical ribbon. Retain the existing basin, bright ejecta and dark gray-brown substrate, without inventing a second giant ring basin. Keep recognizable clear terrain registered. Crater fields must not turn into repeated identical beads or high contrast stippling. No straight meridian boundary between high- and low-detail terrain.''',
}
COMMON = '''
OUTPUT: One flat 2:1 equirectangular global surface color texture for an interactive Three.js sphere. Full 360 degrees longitude and 180 degrees latitude, north at top, equator at half height. The reference maps already use the target registration: do not rotate, crop, shift, flip or add margins. All pixels are surface; no globe silhouette, space, stars, atmosphere, horizon, lighting terminator, cast shadow, frame, words, labels, map grid or watermark. Uniform diffuse illumination suitable for albedo; no directional globe lighting. Keep physical terrain identity and large-scale features. Both horizontal edges must describe immediately adjoining terrain without a brightness jump; the polar rows converge to a point on the sphere. Subtle microrelief, no painted blur, no repeated clones, no hard rectangular patches. Requested output 2048 by 1024. This is visualization repair, never a claim of new observational data.
'''


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path, size=None):
    im = Image.open(path).convert('RGB')
    return im.resize(size, Image.Resampling.LANCZOS) if size and im.size != size else im


def stats(im):
    a = np.asarray(im, dtype=np.float32)
    edge = float(np.abs(a[:, 0] - a[:, -1]).mean())
    adjacent = np.abs(a[:, 1:] - a[:, :-1]).mean(axis=(0, 2))
    gray = a.mean(axis=2)
    return {'dimensions': list(im.size), 'edgeMeanDifference': edge,
            'edgeMaxDifference': float(np.abs(a[:, 0] - a[:, -1]).max()),
            'typicalColumnDifference': float(np.median(adjacent)),
            'darkPixelFractionBelow8': float((gray < 8).mean()),
            'darkPixelFractionBelow24': float((gray < 24).mean()),
            'northRowMean': float(gray[0].mean()),
            'lowestTileMean': min(float(tile.mean()) for row in np.array_split(gray, 12)
                                  for tile in np.array_split(row, 24, axis=1))}


def prepare(work):
    jobs = []
    for body, source in SOURCES.items():
        im = load(TEXTURES / source)
        (work / 'before').mkdir(parents=True, exist_ok=True)
        im.save(work / 'before' / f'{body}.png')
        prompt = work / 'work/imagegen' / f'{body}.txt'
        prompt.parent.mkdir(parents=True, exist_ok=True)
        prompt.write_text(DESCRIPTIONS[body] + '\n' + COMMON, encoding='utf-8')
        refs = [str(TEXTURES / source)]
        if body in ('triton', 'charon', 'callisto'):
            refs.append(str(TEXTURES / f'2k_{body}.jpg'))
        jobs.append({'mode': 'edit', 'images': refs, 'prompt_file': str(prompt),
                     'out': str(work / 'generated' / f'{body}.png'),
                     'size': '2048x1024'})
    (work / 'work/imagegen/jobs.json').write_text(json.dumps(jobs, indent=2), encoding='utf-8')
    report = {body: stats(load(TEXTURES / source)) for body, source in SOURCES.items()}
    (work / 'before.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


def smoothstep(x):
    t = np.clip(x, 0, 1)
    return t * t * (3 - 2 * t)


def preservation_mask(body, size):
    w, h = size
    y, x = np.mgrid[:h, :w] / np.array([h, w])[:, None, None]
    if body == 'charon':
        # Only replace the flawed polar band; retain existing terrain below it.
        return np.broadcast_to(smoothstep((y - .12) / .12), (h, w))
    if body == 'callisto':
        # Keeping the old rectangular panels restores their false meridian edges.
        # Protect the identifiable basin core with an irregular, broad transition.
        radius = np.sqrt(((x - .35) / .13) ** 2 + ((y - .41) / .23) ** 2)
        radius += .06 * np.sin(x * 83) * np.cos(y * 51)
        return 1 - smoothstep((radius - .62) / .75)
    if body == 'triton':
        raw = load(TEXTURES / '2k_triton.jpg', size)
        coverage = Image.fromarray((np.asarray(raw).max(axis=2) > 18).astype('uint8') * 255)
        # An eroded observed core avoids restoring the defective footprint edge.
        for _ in range(4):
            coverage = coverage.filter(ImageFilter.MinFilter(9))
        soft = np.asarray(coverage.filter(ImageFilter.GaussianBlur(w * .018)), dtype=float) / 255
        return smoothstep((soft - .08) / .84)
    return np.zeros((h, w), dtype=np.float32)


def soften_footprint(im):
    # Remove residual low-frequency lighting along the original Voyager footprint.
    # This is local artistic retouching, not a photometric calibration.
    small = im.resize((1024, 512), Image.Resampling.LANCZOS)
    a = np.asarray(small)
    coverage = (np.asarray(load(TEXTURES / '2k_triton.jpg', small.size)).max(axis=2) > 18).astype('uint8')
    inside = cv2.distanceTransform(coverage, cv2.DIST_L2, 5)
    outside = cv2.distanceTransform(1 - coverage, cv2.DIST_L2, 5)
    distance = inside + outside
    band = (distance < 18).astype('uint8') * 255
    low = cv2.GaussianBlur(a, (0, 0), 8)
    healed = cv2.inpaint(low, band, 5, cv2.INPAINT_TELEA)
    weight = 1 - smoothstep((distance - 7) / 15)
    correction = (healed.astype(float) - low.astype(float)) * weight[..., None]
    correction = cv2.resize(correction, im.size, interpolation=cv2.INTER_CUBIC)
    return Image.fromarray(np.clip(np.rint(np.asarray(im) + correction), 0, 255).astype('uint8'))


def wrap(im):
    a = np.asarray(im, dtype=np.float32).copy()
    h, w, _ = a.shape
    # A narrow blend only regularizes edge samples; visual QA checks the wider terrain.
    band = max(4, round(w * .008))
    left, right = a[:, :band].copy(), a[:, -band:][:, ::-1].copy()
    weight = (1 - smoothstep(np.linspace(0, 1, band)))[None, :, None] * .5
    a[:, :band] = left * (1 - weight) + right * weight
    a[:, -band:] = (right * (1 - weight) + left * weight)[:, ::-1]
    polar = max(3, round(h * .015))
    for i in range(polar):
        weight = 1 - smoothstep(i / (polar - 1))
        for row in (i, h - i - 1):
            a[row] = a[row] * (1 - weight) + a[row].mean(axis=0) * weight
    return Image.fromarray(np.clip(np.rint(a), 0, 255).astype('uint8'))


def register(generated, reference):
    # Recover map registration from matching terrain, not the provider's canvas ratio.
    width = generated.width
    reference = reference.resize((width, width // 2), Image.Resampling.LANCZOS)
    sift = cv2.SIFT_create(nfeatures=24000, contrastThreshold=.01)
    ka, da = sift.detectAndCompute(np.asarray(reference.convert('L')), None)
    kb, db = sift.detectAndCompute(np.asarray(generated.convert('L')), None)
    pairs = cv2.BFMatcher().knnMatch(da, db, k=2)
    good = [a for a, b in pairs if a.distance < .8 * b.distance]
    source = np.float32([ka[m.queryIdx].pt for m in good])
    target = np.float32([kb[m.trainIdx].pt for m in good])
    transform, inliers = cv2.estimateAffine2D(source, target, method=cv2.RANSAC, ransacReprojThreshold=6, maxIters=10000)
    if transform is None or int(inliers.sum()) < 25:
        raise ValueError('Insufficient matching terrain to register the returned canvas')
    selected = inliers.ravel().astype(bool)
    span = np.ptp(source[selected], axis=0) / [width, width/2]
    if min(span) < .25:
        raise ValueError('Matching terrain does not cover enough of the map')
    if not (.95 < transform[0, 0] < 1.05 and .93 < transform[1, 1] < 1.16
            and abs(transform[0, 1]) < .02 and abs(transform[1, 0]) < .02
            and abs(transform[0, 2]) < width * .03 and abs(transform[1, 2]) < width * .05):
        raise ValueError('Registration would shift or deform the map excessively')
    predicted = source @ transform[:, :2].T + transform[:, 2]
    residual = np.linalg.norm(predicted - target, axis=1)[selected]
    aligned = cv2.warpAffine(np.asarray(generated), transform, (width, width//2),
                             flags=cv2.INTER_LANCZOS4 | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REFLECT_101)
    return Image.fromarray(aligned), {'method': 'SIFT terrain correspondence / RANSAC affine registration to previous equirectangular map',
                                    'referenceToGeneratedMatrix': transform.tolist(), 'matchedFeatures': len(good),
                                    'inliers': int(inliers.sum()), 'referenceCoverageSpan': span.tolist(),
                                    'medianResidualPixels': float(np.median(residual)),
                                    'registeredDimensions': [width, width//2]}


def finalize(work):
    out = TEXTURES / 'repaired'
    out.mkdir(parents=True, exist_ok=True)
    records = []
    for body, source in SOURCES.items():
        path = work / 'generated' / f'{body}.png'
        if not path.exists():
            continue
        generated = load(path)
        w, h = generated.size
        aligned, registration = register(generated, load(TEXTURES / source))
        if body == 'triton':
            aligned = soften_footprint(aligned)
        # Keep the established high-resolution grid for locally repaired maps.
        size = load(TEXTURES / source).size if body in ('charon', 'callisto', 'triton') else aligned.size
        original = load(TEXTURES / source, size)
        mask = preservation_mask(body, size)
        old = np.asarray(original, dtype=float)
        new = np.asarray(aligned.resize(size, Image.Resampling.LANCZOS), dtype=float)
        composed = Image.fromarray(np.clip(np.rint(old * mask[..., None] + new * (1-mask[..., None])), 0, 255).astype('uint8'))
        result = wrap(composed)
        high = out / f'{body}-{size[0]}.webp'
        result.save(high, lossless=True, method=6)
        basewidth = min(1920, size[0] // 2)
        base = out / f'{body}-{basewidth}.webp'
        overview = wrap(result.resize((basewidth, basewidth // 2), Image.Resampling.LANCZOS))
        overview.save(base, quality=86, method=6)
        final = np.asarray(load(high))
        assert np.array_equal(final, np.asarray(result))
        protected = mask == 1
        margin = round(size[0] * .008) + 1
        protected[:, :margin] = False
        protected[:, -margin:] = False
        polar = round(size[1] * .015) + 1
        protected[:polar] = False
        protected[-polar:] = False
        error = int(np.abs(final.astype(int)[protected] - old.astype(int)[protected]).max()) if protected.any() else None
        assert error in (None, 0)
        Image.fromarray(np.rint(mask * 255).astype('uint8')).save(out / f'{body}-preservation-mask.png')
        prompt = work / 'work/imagegen' / f'{body}.txt'
        (out / f'{body}-prompt.txt').write_text(prompt.read_text(encoding='utf-8'), encoding='utf-8')
        records.append({'id': body, 'reference': source, 'referenceSha256': sha(TEXTURES / source),
                        'originalObservationReference': f'2k_{body}.jpg' if body in ('triton', 'charon', 'callisto') else source,
                        'mode': 'reference image edit with local preservation' if protected.any() else 'whole-map reference repaint',
                        'requestedDimensions': [2048, 1024], 'generatedDimensions': [w, h],
                        'deliveredDimensions': list(size), 'generationResampledForComposite': list(size) != [w, h],
                        'base': base.name, 'high': high.name, 'baseSha256': sha(base), 'highSha256': sha(high),
                        'generatedSha256': sha(path), 'registration': registration,
                        'preservedPreviousMapPixels': int(protected.sum()),
                        'preservedMaxChannelDifference': error, 'before': stats(original), 'after': stats(result),
                        'baseEncoding': 'WebP quality 86', 'baseAfter': stats(load(base))})
        print(f'{body}: native generation {w}x{h}; delivery {size}; protected={int(protected.sum())}; max difference={error}', flush=True)
    manifest = {'version': 1, 'date': '2026-09-15', 'provider': 'Bafang API',
                'model': 'gpt-image-2.5-sunburst', 'requestedQuality': 'high',
                'qualityExecutionVerified': False,
                'policy': 'AI repair for visualization, not new measured terrain. Preservation counts refer to the previous published map, which itself contains observed and AI-completed terrain. Masks are visual editing choices, not certified observation coverage.',
                'processing': 'Terrain-based affine registration; Triton footprint low-frequency boundary retouch; generated terrain locally composited with published reference using saved masks; 0.8% longitude edge blend and 1.5% polar convergence. High tier lossless WebP, overview WebP quality 86. Larger composite dimensions preserve old-map sampling and do not imply increased native generated detail.',
                'textures': records}
    (out / 'provenance.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', choices=['prepare', 'finalize'])
    parser.add_argument('--work', type=Path, required=True)
    args = parser.parse_args()
    (prepare if args.stage == 'prepare' else finalize)(args.work)
