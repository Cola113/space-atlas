// Routes and build entries share one registry. Scene engines own their units and controls.
export const scenes = Object.freeze([
  Object.freeze({ id: "solar-system", name: "太阳系", english: "SOLAR SYSTEM", path: "/solar-system/", icon: "orbit", capabilities: ["time", "bodies", "clouds", "labels", "orbits"] }),
  Object.freeze({ id: "black-hole", name: "黑洞", english: "BLACK HOLE", path: "/black-hole/", icon: "aperture", capabilities: ["time", "quality", "capture", "cruise"] }),
]);

export const sceneById = (id) => scenes.find(scene => scene.id === id);
