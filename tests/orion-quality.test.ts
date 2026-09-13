import test from 'node:test';
import assert from 'node:assert/strict';
import {AdaptiveQuality,profiles} from '../orion-nebula/src/Quality';
test('automatic mode drops below energy-saving and manual mode never changes tier',()=>{
 const quality=new AdaptiveQuality(()=>{});let now=0;
 for(let i=0;i<240;i++){now+=50;quality.sample(50,now);}
 assert.equal(quality.current,'minimal');
 quality.set('high',now);
 for(let i=0;i<240;i++){now+=80;quality.sample(80,now);}
 assert.equal(quality.current,'high');
 assert.ok(profiles.minimal.pixels*profiles.minimal.steps<profiles.low.pixels*profiles.low.steps*.1);
});
test('stable evidence upgrades, a failed probe rolls back and cannot immediately repeat',()=>{
 const q=new AdaptiveQuality(()=>{});let now=0;
 while(now<23000){now+=1000/60;q.sample(1000/60,now);}
 assert.equal(q.current,'high');
 for(let i=0;i<160&&!q.history.some(h=>h.reason==='probe-rollback');i++){now+=40;q.sample(40,now);}
 assert.equal(q.current,'low');
 const end=now+30000;
 while(now<end){now+=1000/60;q.sample(1000/60,now);}
 assert.equal(q.current,'low');assert.ok(q.history.some(h=>h.reason==='probe-rollback'));
});
test('reset excludes startup and background gaps from adaptation',()=>{
 const q=new AdaptiveQuality(()=>{});q.reset(10000);q.sample(10000,10000);assert.equal(q.current,'low');
 q.sample(NaN,12000);assert.equal(q.current,'low');
});
