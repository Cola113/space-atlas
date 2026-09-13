// One queue for texture requests. Promotion does not duplicate an in-flight job.
export class AssetQueue {
 constructor(limit=4){this.limit=limit;this.active=0;this.jobs=new Map();this.pending=[];this.disposed=false;}
 request(key,run,priority=0){
  const existing=this.jobs.get(key);
  if(existing){existing.priority=Math.max(existing.priority,priority);return existing.promise;}
  let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
  const job={key,run,priority,promise,resolve,reject};this.jobs.set(key,job);this.pending.push(job);this.pump();return promise;
 }
 pump(){while(!this.disposed&&this.active<this.limit&&this.pending.length){
  this.pending.sort((a,b)=>b.priority-a.priority);const job=this.pending.shift();this.active++;
  Promise.resolve().then(job.run).then(job.resolve,error=>{this.jobs.delete(job.key);job.reject(error);}).finally(()=>{this.active--;this.pump();});
 }}
 dispose(){this.disposed=true;for(const job of this.pending)job.reject(new Error('Scene disposed'));this.pending=[];this.jobs.clear();}
}
