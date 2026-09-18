export const EPHEMERIS_YEARS = Object.freeze({ first: 1900, last: 2100 });
export const EPHEMERIS_SYSTEMS = Object.freeze({
  enceladus: 'saturn', titan: 'saturn', miranda: 'uranus', pluto: 'pluto', charon: 'pluto',
  ceres: 'ceres',
});
export const EPHEMERIS_SYSTEM_IDS = Object.freeze(Object.keys(EPHEMERIS_SYSTEMS).concat(['saturn','uranus']));
const SYSTEM_NAMES = Object.freeze({ saturn:'土星', uranus:'天王星', pluto:'冥王星', ceres:'谷神星' });

export class MissingEphemerisError extends Error {
  constructor(system, year, cause) {
    super(`${year} 年${SYSTEM_NAMES[system] || system}星历尚未就绪`, { cause });
    this.name = 'MissingEphemerisError'; this.system = system; this.year = year;
  }
}

export function decodeEphemeris(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 16 || new TextDecoder().decode(new Uint8Array(buffer, 0, 8)) !== 'ATLEPH01') throw new Error('Invalid ephemeris header');
  const headerSize = view.getUint32(8, true), dataSize = view.getUint32(12, true), base = 16 + headerSize;
  if (base + dataSize !== buffer.byteLength || headerSize % 8) throw new Error('Truncated ephemeris file');
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 16, headerSize)));
  if (header.version !== 1 || header.frame !== 'J2000' || header.timescale !== 'TDB' || header.units !== 'km' || !Array.isArray(header.tracks) || !header.tracks.length) throw new Error('Unsupported ephemeris format');
  return {...header, tracks: header.tracks.map(track => {
    const { count, degree, precision, offset, initial, interval } = track;
    if (!Number.isInteger(count) || count < 1 || !Number.isInteger(degree) || degree < 1 || degree > 64 || ![4,8].includes(precision) || !Number.isInteger(offset) || offset < 0 || offset % 8 || !Number.isFinite(initial) || !(interval > 0)) throw new Error('Invalid ephemeris record');
    const length = count * 3 * (degree + 1);
    if (offset + length * precision > dataSize) throw new Error('Ephemeris coefficients exceed file');
    const coefficients = precision === 4 ? new Float32Array(buffer, base + offset, length) : new Float64Array(buffer, base + offset, length);
    return {...track, coefficients};
  })};
}

/** Original SPK Chebyshev polynomials, with km output in the J2000 frame.
 * No interpolation between sparse snapshots, light-time or observer correction.
 */
export function evaluateEphemeris(bundle, target, center, tdbSeconds) {
  if (!Number.isFinite(tdbSeconds)) throw new RangeError('Invalid ephemeris date');
  // Last SPK segment wins in an overlap, matching the source-kernel priority.
  const track = bundle.tracks.findLast(t => t.target === target && t.center === center && tdbSeconds >= t.initial && tdbSeconds <= t.initial + t.count * t.interval);
  if (!track) throw new RangeError(`No ephemeris coverage for ${center} → ${target} at ${tdbSeconds}`);
  const index = Math.min(track.count - 1, Math.floor((tdbSeconds - track.initial) / track.interval));
  const x = 2 * ((tdbSeconds - track.initial) - index * track.interval) / track.interval - 1;
  const n = track.degree + 1, offset = index * 3 * n, output = [];
  for (let axis = 0; axis < 3; axis++) {
    const start = offset + axis * n;
    let next = 0, after = 0;
    for (let k = n - 1; k > 0; k--) {
      const value = track.coefficients[start + k] + 2 * x * next - after;
      after = next; next = value;
    }
    output.push(track.coefficients[start] + x * next - after);
  }
  if (!output.every(Number.isFinite)) throw new Error('Corrupt ephemeris coefficients');
  return output;
}

export function inEphemerisRange(date) {
  const year = date.getUTCFullYear();
  return year >= EPHEMERIS_YEARS.first && year <= EPHEMERIS_YEARS.last;
}

export class EphemerisStore {
  constructor({fetcher = (...args) => globalThis.fetch(...args), maxEntries = 9, timeoutMs = 15000} = {}) {
    this.fetcher = fetcher; this.maxEntries = maxEntries; this.timeoutMs = timeoutMs;
    this.cache = new Map(); this.pending = new Map(); this.failures = new Map();
    this.disposed = false; this.revision = 0;
  }
  get(system, year) {
    const key = `${system}/${year}`, bundle = this.cache.get(key);
    if (bundle) { this.cache.delete(key); this.cache.set(key, bundle); }
    return bundle;
  }
  require(system, date) {
    if (!inEphemerisRange(date)) return null;
    const year = date.getUTCFullYear(), bundle = this.get(system, year);
    if (!bundle) throw new MissingEphemerisError(system, year, this.failures.get(`${system}/${year}`));
    return bundle;
  }
  load(system, year) {
    if (this.disposed) return Promise.reject(new Error('Ephemeris store disposed'));
    if (!EPHEMERIS_SYSTEM_IDS.includes(system) || !Number.isInteger(year) || year < EPHEMERIS_YEARS.first || year > EPHEMERIS_YEARS.last) return Promise.reject(new RangeError('Unsupported ephemeris year or system'));
    const key = `${system}/${year}`, cached = this.get(system, year);
    if (cached) return Promise.resolve(cached);
    if (this.pending.has(key)) return this.pending.get(key).promise;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('Ephemeris request timed out')), this.timeoutMs);
    const promise = Promise.resolve().then(async () => {
      const response = await this.fetcher(`/ephemeris/${key}.bin`, {signal: controller.signal});
      if (!response.ok) throw new Error(`Ephemeris HTTP ${response.status}`);
      const bundle = decodeEphemeris(await response.arrayBuffer());
      if (bundle.system !== system || bundle.year !== year) throw new Error('Wrong ephemeris year or system');
      if (this.disposed) throw new Error('Ephemeris store disposed');
      this.cache.set(key, bundle); this.failures.delete(key);
      while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value);
      this.revision++;
      return bundle;
    }).catch(error => { this.failures.set(key, error); throw new MissingEphemerisError(system, year, error); })
      .finally(() => { clearTimeout(timer); this.pending.delete(key); });
    this.pending.set(key, {promise, controller});
    return promise;
  }
  async ensure(date, systems, {prefetch = true} = {}) {
    if (!inEphemerisRange(date)) return;
    const year = date.getUTCFullYear(), unique = [...new Set(systems)];
    await Promise.all(unique.map(system => this.load(system, year)));
    if (prefetch) for (const system of unique) for (const neighbor of [year - 1, year + 1]) {
      if (neighbor >= EPHEMERIS_YEARS.first && neighbor <= EPHEMERIS_YEARS.last) void this.load(system, neighbor).catch(() => {});
    }
  }
  dispose() {
    this.disposed = true;
    for (const item of this.pending.values()) item.controller.abort();
    this.cache.clear(); this.failures.clear();
    this.revision++;
  }
}
