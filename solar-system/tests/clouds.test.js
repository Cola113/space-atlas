import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createServer } from "node:http";
import sharp from "sharp";
import * as THREE from "three";
import { createCloudService, makeCloudTexture, observationTime, imageRequest } from "../server/cloud-service.js";
import { cloudAge, CLOUD_CHECK_MS } from "../src/cloud-policy.js";
import { alignObservedEarth, subsolarPoint } from "../src/earth-observation.js";
import { updatePrimaryOrbits } from "../src/orbits.js";

const width = 2048, height = 1024;
const raw = Buffer.alloc(width * height * 4);
for (let i = 0; i < width * height; i++) {
  const value = 40 + Math.floor((i % width) / width * 210);
  raw[i*4] = raw[i*4+1] = raw[i*4+2] = value; raw[i*4+3] = 255;
}
// Equatorial warm surface, cloud, opaque saturated fill, and transparent missing data.
for (const [x, value, alpha] of [[100,40,255],[1000,200,255],[1500,255,255],[1700,200,0]]) {
  const i = (512 * width + x) * 4;
  raw[i] = raw[i+1] = raw[i+2] = value; raw[i+3] = alpha;
}
const fixture = await sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
const xml = time => `<WMS_Capabilities><Layer><Name>mumi:worldcloudmap_ir108</Name><Dimension name="time" default="${time}"/></Layer></WMS_Capabilities>`;

test("cloud texture preserves coordinates and masks warm/saturated/unobserved samples", async () => {
  const { png, coveragePercent } = await makeCloudTexture(fixture);
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, width); assert.equal(info.height, height);
  const pixel = (x,y) => [...data.subarray((y*width+x)*4,(y*width+x)*4+4)];
  assert.equal(pixel(100,512)[0], 0);
  assert.ok(pixel(1000,512)[0] > 210);
  assert.equal(pixel(1500,512)[3], 0);
  assert.equal(pixel(1700,512)[3], 0);
  assert.equal(pixel(1000,0)[3], 0);
  assert.equal(pixel(1000,1023)[3], 0);
  assert.ok(coveragePercent > 70 && coveragePercent < 90);
  const request = new URL(imageRequest("2026-09-08T15:00:00Z"));
  assert.equal(request.searchParams.get("crs"), "CRS:84");
  assert.equal(request.searchParams.get("bbox"), "-180,-90,180,90");
  await assert.rejects(makeCloudTexture(Buffer.from("not an image")));
  const empty = await sharp({create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
  await assert.rejects(makeCloudTexture(empty), /覆盖不足/);
});

test("source dates must be present and cannot be invented from download time", () => {
  const now = Date.parse("2026-09-08T17:00:00Z");
  assert.equal(observationTime(xml("2026-09-08T15:00:00Z"), now), "2026-09-08T15:00:00.000Z");
  assert.throws(() => observationTime(xml("2027-01-01T00:00:00Z"), now));
  assert.throws(() => observationTime("<error>missing layer</error>", now));
});

test("hourly fetch is deduplicated; failures/restarts retain the last valid immutable frame", async t => {
  const directory = await mkdtemp(join(tmpdir(), "solar-atlas-cloud-test-"));
  t.after(async () => {
    const target = resolve(directory), parent = resolve(tmpdir()) + sep;
    assert.ok(target.startsWith(parent) && target.slice(parent.length).startsWith("solar-atlas-cloud-test-"));
    await rm(target, { recursive:true, force:true });
  });
  let clock = Date.parse("2026-09-08T17:00:00Z"), time = "2026-09-08T15:00:00Z";
  let failure = false, brokenImage = false, calls = 0, imageCalls = 0;
  const fetcher = async url => {
    calls++;
    if (failure) throw new Error("offline");
    if (url.includes("GetCapabilities")) return new Response(xml(time));
    imageCalls++; return new Response(brokenImage ? Buffer.from("incomplete") : fixture);
  };
  const service = createCloudService({ directory, fetcher, now: () => clock });
  await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
  assert.equal(calls, 2);
  const first = service.snapshot().frame;
  assert.ok(first);
  const bytes = await readFile(join(directory, first.file));
  await service.refresh(); assert.equal(calls, 2);
  clock += CLOUD_CHECK_MS;
  await service.refresh(); assert.equal(imageCalls, 1);
  clock += CLOUD_CHECK_MS; time = "2026-09-08T18:00:00Z";
  await service.refresh();
  const second = service.snapshot().frame;
  assert.notEqual(first.file, second.file);
  assert.deepEqual(await readFile(join(directory, first.file)), bytes);
  clock += CLOUD_CHECK_MS; time = "2026-09-08T12:00:00Z";
  await service.refresh(); assert.equal(service.snapshot().frame.file, second.file);
  clock += CLOUD_CHECK_MS; time = "2026-09-08T21:00:00Z"; brokenImage = true;
  await service.refresh(); assert.equal(service.snapshot().frame.file, second.file);
  assert.ok(service.snapshot().error);
  assert.equal(JSON.parse(await readFile(join(directory,"latest.json"))).file, second.file);
  clock += 9 * CLOUD_CHECK_MS; failure = true;
  const restarted = createCloudService({ directory, fetcher, now: () => clock });
  await restarted.refresh();
  assert.equal(restarted.snapshot().frame.observedAt, second.observedAt);
  assert.equal(restarted.snapshot().stale, true);
  assert.equal(cloudAge({...second,fetchedAt:new Date(clock).toISOString()},clock).stale,true);
  const http = createServer((req,res)=>restarted.middleware(req,res,()=>{res.writeHead(404);res.end();}));
  await new Promise(resolve => http.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>http.close(resolve)));
  const base = `http://127.0.0.1:${http.address().port}`;
  const metadata = await fetch(base+"/api/clouds");
  assert.equal(metadata.headers.get("cache-control"),"no-store");
  assert.equal((await metadata.json()).frame.file,second.file);
  assert.equal((await fetch(base+`/api/clouds/images/${second.file}`)).status,200);
  assert.equal((await fetch(base+"/api/clouds/images/latest.json")).status,404);
  assert.equal((await fetch(base+"/api/clouds/images/%2e%2e%2fpackage.json")).status,404);
});

test("Earth longitude and illumination align with the observed UTC date across seasons", () => {
  for (const stamp of ["2026-03-20T12:00:00Z","2026-06-21T00:00:00Z","2026-09-08T17:00:00Z","2026-12-21T06:00:00Z"]) {
    const date = new Date(stamp), point = subsolarPoint(date);
    const body = {id:"earth",body:"Earth",orbit:35.54,root:new THREE.Group(),tilted:new THREE.Group(),
      mesh:new THREE.Object3D(),clouds:new THREE.Object3D(),orbitCenter:new THREE.Vector3()};
    body.root.add(body.tilted); body.tilted.add(body.mesh,body.clouds);
    updatePrimaryOrbits(new Map([["earth",body]]),date);
    alignObservedEarth(body,point);
    body.root.updateMatrixWorld(true);
    const lat=point.latitude*Math.PI/180,lon=point.longitude*Math.PI/180;
    const direction=new THREE.Vector3(Math.cos(lat)*Math.cos(lon),Math.sin(lat),-Math.cos(lat)*Math.sin(lon));
    const q=body.mesh.getWorldQuaternion(new THREE.Quaternion());
    direction.applyQuaternion(q);
    const sun=body.root.position.clone().negate().normalize();
    assert.ok(direction.angleTo(sun)*180/Math.PI<0.1,stamp);
    assert.equal(body.mesh.rotation.y,body.clouds.rotation.y);
  }
});
