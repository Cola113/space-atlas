import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bodies } from '../src/data.js';
import { SIMULATION_EPOCH, updateBodyRotations, updateSatelliteOrbits } from '../src/orbits.js';

const body = id => ({...bodies.find(item => item.id === id), root:new THREE.Group(), tilted:new THREE.Group(), mesh:new THREE.Mesh(), orbitCenter:new THREE.Vector3(), orbitLine:new THREE.Line()});

test('satellite orbit positions use the same simulation date as planetary positions',()=>{
  const europa=body('europa'),jupiter=body('jupiter');
  jupiter.root.position.set(20,0,0);jupiter.tilted.quaternion.identity();
  const objects=new Map([['jupiter',jupiter],['europa',europa]]);
  updateSatelliteOrbits(objects,new Date(SIMULATION_EPOCH));
  const first=europa.root.position.clone();
  updateSatelliteOrbits(objects,new Date(SIMULATION_EPOCH+europa.period*86400000));
  assert.ok(first.distanceTo(europa.root.position)<europa.orbit*.05,'near-period recurrence includes perturbations and changing apsides');
  updateSatelliteOrbits(objects,new Date(SIMULATION_EPOCH+europa.period*86400000/4));
  assert.ok(first.distanceTo(europa.root.position)>1,'date changes move the satellite');
});

test('planet rotation is date-driven even when a legacy lock parameter is supplied',()=>{
  const earth=body('earth'),jupiter=body('jupiter');
  const objects=new Map([['earth',earth],['jupiter',jupiter]]);
  updateBodyRotations(objects,new Date(SIMULATION_EPOCH));
  const initial=earth.mesh.rotation.y, jupiterInitial=jupiter.mesh.rotation.y;
  updateBodyRotations(objects,new Date(SIMULATION_EPOCH+86400000));
  assert.notEqual(earth.mesh.rotation.y,initial);
  assert.notEqual(jupiter.mesh.rotation.y,jupiterInitial);
  const held=earth.mesh.rotation.y;
  updateBodyRotations(objects,new Date(SIMULATION_EPOCH+2*86400000),'earth');
  assert.notEqual(earth.mesh.rotation.y,held,'camera tracking must not freeze physical rotation');
});
