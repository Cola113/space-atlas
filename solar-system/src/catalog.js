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
export function satelliteNumber(name) {
  const suffix = name.match(/卫([一二三四五六七八九十百]+)$/)?.[1];
  if (!suffix) return Infinity;
  const digits = {一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  let total = 0, digit = 0;
  for (const char of suffix) {
    if (char === '十' || char === '百') { total += (digit || 1) * (char === '十' ? 10 : 100); digit = 0; }
    else digit = digits[char];
  }
  return total + digit;
}
const bySatelliteName = (a, b) => satelliteNumber(a.name) - satelliteNumber(b.name) || byDistance(a, b);
export const systemName = body => body.id === 'earth' ? '地月系' : `${body.name}系`;
export const systemMembers = id => [byId.get(id), ...bodies.filter(body => body.parent === id).sort(bySatelliteName)].filter(Boolean);
export const satelliteSystems = bodies.filter(body => !body.parent && bodies.some(moon => moon.parent === body.id)).sort(byDistance);

// Sort copies for navigation only: the simulation's parent/child update order
// and every body's stable ID remain independent of the catalogue layout.
export const catalogSections = [
  ...[['planets', '太阳与行星'], ['dwarfs', '矮行星'], ['asteroids', '小行星']].map(([type, title]) => ({
    id: type, type, title, order: '按距太阳由近到远', items: bodies.filter(body => bodyType(body) === type).sort(byDistance),
  })),
  ...satelliteSystems.map(parent => ({
    id: `moons-${parent.id}`, type: 'moons', title: `${systemName(parent)} · 卫星`,
    order: '按卫星名称序数排列', items: systemMembers(parent.id).slice(1),
  })),
];

export const dockCatalogs = [
  ...catalogSections.filter(section => section.type !== 'moons'),
  ...satelliteSystems.map(parent => ({id: `system:${parent.id}`, title: systemName(parent),
    order: '主星在前 · 卫星按名称序数排列', items: systemMembers(parent.id)})),
];

export function dockCatalogFor(body) {
  if (body.parent) return `system:${body.parent}`;
  if (satelliteSystems.some(parent => parent.id === body.id)) return `system:${body.id}`;
  return bodyType(body);
}

// Different entry/exit distances keep wheel and pinch gestures stable at a boundary.
export function proximityCatalog(current, candidates, fallback = 'planets') {
  const active = candidates.find(candidate => current === `system:${candidate.id}`);
  if (active && active.distance < active.exit) return current;
  const nearest = candidates.filter(candidate => candidate.eligible && candidate.distance < candidate.enter)
    .sort((a, b) => a.distance / a.enter - b.distance / b.enter)[0];
  return nearest ? `system:${nearest.id}` : current.startsWith('system:') ? fallback : current;
}

const normalize = value => value.normalize('NFKC').toLocaleLowerCase().replace(/[ʻ’']/g, '').trim();
export function matchesCatalog(body, {query = '', type = 'all', system = 'all'} = {}) {
  if (type !== 'all' && bodyType(body) !== type) return false;
  if (system !== 'all' && body.id !== system && body.parent !== system) return false;
  const parent = byId.get(body.parent);
  const text = normalize(`${body.id} ${body.name} ${body.english} ${body.category} ${parent?.name || ''} ${parent?.english || ''}`);
  return normalize(query).split(/\s+/).every(word => text.includes(word));
}
