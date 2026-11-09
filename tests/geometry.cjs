const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Three = require("../src/vendor/three.min.js");
const code = fs.readFileSync(
  path.join(__dirname, "../src/geometry.js"),
  "utf8",
);
const G = new Function("THREE", code + "\nreturn ChestGeometry;")(Three);
for (const dimensions of [
  G.defaults,
  {
    ...G.defaults,
    chest: 1150,
    depth: 340,
    waist: 970,
    shoulders: 490,
    length: 465,
  },
]) {
  const { geometry, guides } = G.mannequin(dimensions);
  for (const key of Object.keys(dimensions)) {
    const points = guides[key].map((p) => new Three.Vector3(...p));
    const length = points
      .slice(1)
      .reduce((sum, b, i) => sum + b.distanceTo(points[i]), 0);
    assert(Math.abs(length - dimensions[key]) < 0.001, key);
  }
  const body = new Three.Mesh(geometry);
  for (const pad of G.padSurfaces(body)) {
    const foam = G.foamGeometry(pad, 8),
      pos = foam.attributes.position;
    for (let i = 0; i < pad.surface.length; i++) {
      assert(
        Math.abs(Math.abs(pos.getY(i) - pos.getY(i + pad.surface.length)) - 8) <
          0.001,
      );
    }
    const height = pad.surface[5][2] + 0.001;
    assert(G.cut(new Three.Mesh(foam), 2, height).length > 0);
  }
  assert.equal(G.padSurfaces(body).length, 2);
}
const mesh = new Three.Mesh(new Three.BoxGeometry(90, 12, 110));
mesh.position.set(10, 30, 140);
mesh.rotation.z = 0.3;
mesh.scale.setScalar(1.11);
for (const [plane, level] of [
  [0, 10],
  [1, 30],
  [2, 140],
]) {
  const lines = G.cut(mesh, plane, level);
  assert(lines.length > 0);
  assert(
    lines.flat().every((p) => Math.abs(p.getComponent(plane) - level) < 1e-5),
  );
}
const roundTrip = new Three.Mesh(G.readSTL(G.stl(mesh)));
const before = new Three.Box3().setFromObject(mesh),
  after = new Three.Box3().setFromObject(roundTrip);
assert(
  before.min.distanceTo(after.min) < 0.0001 &&
    before.max.distanceTo(after.max) < 0.0001,
);
assert.throws(
  () => G.mannequin({ ...G.defaults, chest: 380, depth: 300 }),
  /depth/,
);
console.log(
  "Passed physical torso dimensions, foam thickness and cuts, transformed section planes and STL bounds.",
);
