import {readFileSync} from 'node:fs';
import {installEphemeris} from '../src/ephemeris/local.js';
export function loadYear(year){
 const base=new URL(`../../public/solar-system/ephemeris/${year}`,import.meta.url);
 const bytes=readFileSync(new URL(base.href+'.bin'));
 installEphemeris(JSON.parse(readFileSync(new URL(base.href+'.json'),'utf8')),bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
}
loadYear(1971);loadYear(2000);loadYear(2026);
