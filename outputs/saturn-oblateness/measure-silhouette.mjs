import sharp from "sharp";

// Saturn's globe is warm-toned (R well above B); the rings are near-neutral grey and
// space is black, so a channel difference isolates the globe from both.
const WARM = 22;

// Restrict to the central viewport, away from the sidebar and the bottom dock.
const REGION = { x0: 1500, y0: 560, x1: 2500, y1: 1520 };

async function measure(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, channels } = info;

  let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  for (let y = REGION.y0; y < REGION.y1; y++) {
    for (let x = REGION.x0; x < REGION.x1; x++) {
      const i = (y * width + x) * channels;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 70 && r - b > WARM && g > 50) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  // deviceScaleFactor 2 in the captures; report CSS pixels
  const w = (maxX - minX + 1) / 2, h = (maxY - minY + 1) / 2;
  return { width: w, height: h, ratio: h / w, box: [minX / 2, minY / 2, maxX / 2, maxY / 2].map(Math.round) };
}

for (const label of ["before", "after"]) {
  const r = await measure(`outputs/saturn-oblateness/app-${label}/saturn-near.png`);
  console.log(label.padEnd(7), r ? JSON.stringify(r) : "未找到球体");
}
