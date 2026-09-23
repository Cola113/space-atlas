#!/usr/bin/env python3
"""Real-ESRGAN upscale for equirectangular sphere maps (seam-safe, GPU-run).

Why the padding: the upscaler has no idea the image wraps in longitude, so it treats the
left/right edge columns as real borders (and smears/extends them) unless we hand it the
wrapped neighbourhood. We tile the source 3x3 and crop the middle+pad region, upscale
that, then crop the exact central region back out -> pixel-exact 2:1.

Why the retry: the ncnn binary intermittently exits 0 having written a flat black image
(observed ~1 run in 6, always fast). We validate every result and re-run instead of
shipping a black texture.

Usage:
  python sr_equirect.py --in <src> --out <dst> [--target-width 4096] [--scale 0|2|3|4]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from PIL import Image

DEFAULT_EXE = r"C:\Users\lenovo\atlas-work\sr\realesrgan\realesrgan-ncnn-vulkan.exe"
DEFAULT_MODELS = r"C:\Users\lenovo\atlas-work\sr\realesrgan\models"
MAX_ATTEMPTS = 3


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def pad_equirect(im: Image.Image, pad: int) -> Image.Image:
    """Wrap in longitude AND latitude (torus) so the corners are real content."""
    w, h = im.size
    pad = min(pad, w // 4, h // 4)
    tiled = Image.new(im.mode, (3 * w, 3 * h))
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            tiled.paste(im, (w + ox * w, h + oy * h))
    return tiled.crop((w - pad, h - pad, 2 * w + pad, 2 * h + pad))


def snap_seam(im: Image.Image) -> Image.Image:
    """Make the meridian wrap exact by averaging the two edge columns.

    The source maps use the convention col[0] == col[W-1] (verified: seam gap 0.00), so we
    restore that on the upscaled result. This halves any residual step at the wrap and
    cannot shift content (unlike a cross-fade band, which measurably made things worse:
    34 vs 3.5 levels on mimas).
    """
    w, h = im.size
    left = im.crop((0, 0, 1, h))
    right = im.crop((w - 1, 0, w, h))
    avg = Image.blend(left, right, 0.5)
    out = im.copy()
    out.paste(avg, (0, 0))
    out.paste(avg, (w - 1, 0))
    return out


def metrics(im: Image.Image) -> dict:
    try:
        import numpy as np
        a = np.asarray(im.convert("L"), dtype=np.float32)
        return {
            "seam_col_diff": round(float(abs(a[:, 0] - a[:, -1]).mean()), 2),
            "interior_col_diff": round(float(abs(a[:, 1:] - a[:, :-1]).mean()), 2),
            "std": round(float(a.std()), 2),
        }
    except Exception:
        return {}


def run_sr(exe: Path, models: Path, src: Path, dst: Path, scale: int, model: str,
           tile: int, tta: bool) -> float:
    cmd = [str(exe), "-i", str(src), "-o", str(dst), "-s", str(scale),
           "-n", model, "-m", str(models), "-t", str(tile), "-f", "png"]
    if tta:
        cmd.append("-x")
    t0 = time.time()
    proc = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    dt = time.time() - t0
    if proc.returncode != 0 or not dst.exists():
        sys.stderr.write((proc.stdout or "")[-1500:] + "\n" + (proc.stderr or "")[-1500:] + "\n")
        raise RuntimeError(f"upscaler failed (rc={proc.returncode}) for {src}")
    return dt


def upscale(src: Path, im: Image.Image, pad: int, scale: int, sr_size: tuple[int, int],
            tmpdir: Path, args) -> tuple[Image.Image, float, int, tuple[int, int]]:
    """Pad -> upscale -> crop. Retries when the binary hands back a flat image."""
    last_err = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        padded = tmpdir / f"padded-{attempt}.png"
        sr_out = tmpdir / f"sr-{attempt}.png"
        pad_equirect(im, pad).save(padded)
        dt = run_sr(Path(args.exe), Path(args.models), padded, sr_out, scale,
                    args.model, args.tile, args.tta)
        up = Image.open(sr_out)
        up.load()
        off = pad * scale
        cropped = up.crop((off, off, off + sr_size[0], off + sr_size[1]))
        lo, hi = cropped.convert("L").getextrema()
        if (hi - lo) >= 8:
            return cropped, dt, attempt, up.size
        last_err = f"attempt {attempt}: degenerate output (range {lo}..{hi})"
        print(f"  ! {last_err}; retrying", flush=True)
        time.sleep(6)
        for p in (padded, sr_out):
            try:
                p.unlink()
            except OSError:
                pass
    raise RuntimeError(f"upscaler kept returning flat images: {last_err}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    ap.add_argument("--scale", type=int, default=0, choices=[0, 2, 3, 4],
                    help="0 = auto: smallest 2/3/4 that reaches --target-width")
    ap.add_argument("--target-width", type=int, default=4096)
    ap.add_argument("--model", default="realesrgan-x4plus")
    ap.add_argument("--pad", type=int, default=64)
    ap.add_argument("--snap-seam", type=int, default=1)
    ap.add_argument("--tile", type=int, default=0)
    ap.add_argument("--tta", action="store_true")
    ap.add_argument("--quality", type=int, default=92)
    ap.add_argument("--exe", default=DEFAULT_EXE)
    ap.add_argument("--models", default=DEFAULT_MODELS)
    ap.add_argument("--log", default=str(Path(__file__).with_name("sr-provenance.jsonl")))
    ap.add_argument("--dry", action="store_true", help="report geometry only, no upscale")
    args = ap.parse_args()

    src = Path(args.src).resolve()
    dst = Path(args.dst).resolve()
    im = Image.open(src)
    im.load()
    src_size = im.size
    if im.mode != "RGB":
        im = im.convert("RGB")
    w, h = im.size
    pad = min(args.pad, w // 4, h // 4)

    scale = args.scale or max(2, min(4, math.ceil(args.target_width / w)))
    sr_size = (w * scale, h * scale)
    target = (args.target_width, args.target_width // 2)
    if args.dry:
        print(json.dumps({"src": str(src), "src_size": src_size, "pad": pad, "scale": scale,
                          "padded": (w + 2 * pad, h + 2 * pad), "sr_crop": sr_size,
                          "target": target}, indent=2))
        return 0

    tmpdir = Path(tempfile.mkdtemp(prefix="sr-"))
    cropped, dt, attempts, padded_sr = upscale(src, im, pad, scale, sr_size, tmpdir, args)
    cropped = cropped.convert("RGB").resize(target, Image.LANCZOS)
    if args.snap_seam:
        cropped = snap_seam(cropped)

    chk = cropped.convert("L")
    lo, hi = chk.getextrema()
    if chk.size != target:
        raise RuntimeError(f"unexpected output size {chk.size}")
    if (hi - lo) < 8:
        raise RuntimeError(f"degenerate output (range {lo}..{hi}) — refusing to write {dst}")

    dst.parent.mkdir(parents=True, exist_ok=True)
    ext = dst.suffix.lower()
    if ext == ".webp":
        cropped.save(dst, "WEBP", quality=args.quality, method=6)
    elif ext in (".jpg", ".jpeg"):
        cropped.save(dst, "JPEG", quality=args.quality, subsampling=0)
    else:
        cropped.save(dst)

    rec = {
        "src": str(src).replace("\\", "/"),
        "src_sha256": sha256(src),
        "src_size": list(src_size),
        "out": str(dst).replace("\\", "/"),
        "out_sha256": sha256(dst),
        "out_size": list(target),
        "scale": scale,
        "model": args.model,
        "pad": pad,
        "padded_sr_size": list(padded_sr),
        "attempts": attempts,
        "seconds": round(dt, 2),
        "tool": "realesrgan-ncnn-vulkan v0.2.5.0 (20220424 build), x4plus, torus padding",
        "note": ("AI upscale: adds plausible detail, NOT native-resolution capture. "
                 "Seam handled by torus padding + wrap-pair snap."),
        "when": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        **metrics(cropped),
    }
    with open(args.log, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")

    print(json.dumps(rec, ensure_ascii=False, indent=2))
    for p in tmpdir.glob("*"):
        try:
            p.unlink()
        except OSError:
            pass
    try:
        tmpdir.rmdir()
    except OSError:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
