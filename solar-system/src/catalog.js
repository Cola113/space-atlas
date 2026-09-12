import { bodies } from './data.js';
import { physicalData } from './physical-scale.js';

export function bodyType(body) {
  if (body.parent) return 'moons';
  if (body.category.includes('矮行星')) return 'dwarfs';
  return body.id === 'vesta' ? 'asteroids' : 'planets';
}

const distance = body => body.parent ? physicalData[body.id]?.orbitKm : physicalData[body.id]?.orbitAU;
const byDistance = (a, b) => (distance(a) ?? Infinity) - (distance(b) ?? Infinity) || a.id.localeCompare(b.id);
const byId = new Map(bodies.map(body => [body.id, body]));
export const systemName = body => body.id === 'earth' ? '地月系' : `${body.name}系`;
export const systemMembers = id => [byId.get(id), ...bodies.filter(body => body.parent === id).sort(byDistance)].filter(Boolean);
export const satelliteSystems = bodies.filter(body => !body.parent && bodies.some(moon => moon.parent === body.id)).sort(byDistance);

// Sort copies for navigation only: the simulation's parent/child update order
// and every body's stable ID remain independent of the catalogue layout.
export const catalogSections = [
  ...[['planets', '太阳与行星'], ['dwarfs', '矮行星'], ['asteroids', '小行星']].map(([type, title]) => ({
    id: type, type, title, order: '按距太阳由近到远', items: bodies.filter(body => bodyType(body) === type).sort(byDistance),
  })),
  ...satelliteSystems.map(parent => ({
    id: `moons-${parent.id}`, type: 'moons', title: `${systemName(parent)} · 卫星`,
    order: '按距主星由近到远', items: systemMembers(parent.id).slice(1),
  })),
];

export const dockCatalogs = [
  ...catalogSections.filter(section => section.type !== 'moons'),
  ...satelliteSystems.map(parent => ({id: `system:${parent.id}`, title: systemName(parent),
    order: '主星在前 · 卫星由近到远', items: systemMembers(parent.id)})),
];

export function dockCatalogFor(body, current) {
  if (body.parent) return `system:${body.parent}`;
  if (current === `system:${body.id}`) return current;
  return bodyType(body);
}

const normalize = value => value.normalize('NFKC').toLocaleLowerCase().replace(/[ʻ’']/g, '').trim();
export function matchesCatalog(body, {query = '', type = 'all', system = 'all'} = {}) {
  if (type !== 'all' && bodyType(body) !== type) return false;
  if (system !== 'all' && body.id !== system && body.parent !== system) return false;
  const parent = byId.get(body.parent);
  const text = normalize(`${body.id} ${body.name} ${body.english} ${body.category} ${parent?.name || ''} ${parent?.english || ''}`);
  return normalize(query).split(/\s+/).every(word => text.includes(word));
}
