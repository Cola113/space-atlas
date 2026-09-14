import { readFileSync } from "node:fs";

const report = JSON.parse(readFileSync("test-results/saturn-shadows/report.json", "utf8"));

function toBodyFrame(quaternion, vector) {
  const [x, y, z, w] = quaternion;
  const [vx, vy, vz] = vector;
  const ix = -x, iy = -y, iz = -z;
  const tx = 2 * (iy * vz - iz * vy);
  const ty = 2 * (iz * vx - ix * vz);
  const tz = 2 * (ix * vy - iy * vx);
  return [
    vx + w * tx + (iy * tz - iz * ty),
    vy + w * ty + (iz * tx - ix * tz),
    vz + w * tz + (ix * ty - iy * tx),
  ];
}

for (const entry of report) {
  const sun = toBodyFrame(entry.orientation, entry.sunDirection);
  const elevation = Math.asin(sun[1]) * 180 / Math.PI;
  console.log(
    `${entry.name.padEnd(8)} 太阳在土星本体系 (${sun.map((v) => v.toFixed(3)).join(", ")})` +
    `  相对环面仰角 ${elevation.toFixed(2)}°`,
  );
  console.log(
    `         相机相对目标的方向 y 分量: ` +
    `${(entry.camera[1] - entry.target[1]).toFixed(3)}（正=在北半球上方）`,
  );
}
