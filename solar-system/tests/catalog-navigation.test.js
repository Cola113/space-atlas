import test from 'node:test';
import assert from 'node:assert/strict';
import { bodies } from '../src/data.js';
import { dockCatalogFor, systemMembers, satelliteNumber, proximityCatalog } from '../src/catalog.js';

test('satellite designations sort numerically, independently of orbital distance', () => {
  assert.deepEqual(['土卫二', '土卫三', '土卫十', '天卫十一', '木卫十八'].map(satelliteNumber), [2, 3, 10, 11, 18]);
  assert.deepEqual(systemMembers('saturn').slice(1).map(body => body.name),
    ['土卫一', '土卫二', '土卫三', '土卫四', '土卫五', '土卫六', '土卫七', '土卫八', '土卫九', '土卫十', '土卫十一', '土卫十五', '土卫十六', '土卫十七', '土卫十八']);
  for (const id of ['jupiter', 'uranus', 'neptune']) {
    const numbers = systemMembers(id).slice(1).map(body => satelliteNumber(body.name));
    assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b));
  }
});

test('selecting a primary opens its satellites; solitary bodies keep their main category', () => {
  for (const [id, expected] of [['saturn', 'system:saturn'], ['earth', 'system:earth'], ['pluto', 'system:pluto'], ['enceladus', 'system:saturn'], ['venus', 'planets'], ['sun', 'planets'], ['vesta', 'asteroids']])
    assert.equal(dockCatalogFor(bodies.find(body => body.id === id)), expected);
});

test('camera proximity has separate entry and exit boundaries and restores the main category', () => {
  const candidate = distance => [{ id: 'saturn', distance, enter: 10, exit: 30, eligible: true }];
  assert.equal(proximityCatalog('planets', candidate(9)), 'system:saturn');
  assert.equal(proximityCatalog('system:saturn', candidate(11)), 'system:saturn');
  assert.equal(proximityCatalog('system:saturn', candidate(31)), 'planets');
  assert.equal(proximityCatalog('planets', candidate(29)), 'planets');
  assert.equal(proximityCatalog('system:saturn', candidate(31), 'dwarfs'), 'dwarfs');
  assert.equal(proximityCatalog('planets', [{ ...candidate(2)[0], eligible: false }]), 'planets');
});
