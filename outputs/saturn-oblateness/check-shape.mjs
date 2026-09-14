import { bodies } from "../../solar-system/src/data.js";

const shaped = bodies.filter(
  (b) => b.shape && !(b.shape[0] === 1 && b.shape[1] === 1 && b.shape[2] === 1),
);
console.log("有非单位 shape 的天体数:", shaped.length);
for (const b of shaped) {
  console.log("  ", b.id, b.shape.map((v) => Number(v.toFixed(4))));
}

const saturn = bodies.find((b) => b.id === "saturn");
console.log("\n土星 shape =", saturn.shape);
console.log("土星 radius =", saturn.radius);

const landingIds = ["mars", "io", "titan", "enceladus", "pluto", "miranda", "mercury"];
console.log("\n可降落天体的 shape:");
for (const id of landingIds) {
  const b = bodies.find((x) => x.id === id);
  console.log("  ", id, b ? JSON.stringify(b.shape ?? null) : "(未找到)");
}
