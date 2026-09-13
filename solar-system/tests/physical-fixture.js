import { readFile } from 'node:fs/promises';
import { PhysicalState, physicalState } from '../src/physics/state.js';
import { EphemerisStore } from '../src/physics/ephemeris.js';

export const localFetcher = async path => {
  const buffer = await readFile(new URL(`../../public${path}`,import.meta.url));
  return {ok:true,arrayBuffer:async()=>buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)};
};
export const localPhysics = () => new PhysicalState({ephemeris:new EphemerisStore({fetcher:localFetcher})});
export async function prepareSurfaceTests() {
  physicalState.ephemeris.fetcher=localFetcher;
  physicalState.ephemeris.maxEntries=24;
  for(const year of [1900,1971,2000,2026,2040,2100]) {
    await physicalState.ephemeris.ensure(new Date(`${year}-01-01T00:00:00Z`),['saturn','uranus','pluto'],{prefetch:false});
  }
}
