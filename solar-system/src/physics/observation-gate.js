import { MissingEphemerisError } from './ephemeris.js';

/** Preserve clock intent while a required year loads. A failed request stays
 * stopped until explicit retry; it must not start a network request every RAF.
 * The gate never assigns dates or camera state when an old request completes.
 */
export class ObservationGate {
  constructor(provider, ids, onChange = () => {}) {
    this.provider=provider; this.ids=ids; this.onChange=onChange;
    this.pending=null; this.error=null; this.date=null; this.disposed=false; this.generation=0;
  }
  get blocked() { return Boolean(this.pending || this.error); }
  check(date) {
    try {
      this.provider.require(date,this.ids);
      if(this.blocked){this.generation++;this.pending=null;this.error=null;this.onChange();}
      return true;
    }
    catch(error) {
      if(!(error instanceof MissingEphemerisError))throw error;
      this.date=date;
      if(!this.pending && !this.error) void this.wait(date).catch(()=>{});
      return false;
    }
  }
  wait(date) {
    if(this.pending)return this.pending;
    this.date=date; this.error=null;
    const generation=++this.generation;
    this.pending=Promise.resolve().then(()=>this.provider.ensure(date,this.ids))
      .catch(error=>{if(generation===this.generation)this.error=error;throw error;})
      .finally(()=>{if(generation===this.generation){this.pending=null;if(!this.disposed)this.onChange();}});
    if(!this.disposed)this.onChange();
    return this.pending;
  }
  retry() { return this.wait(this.date); }
  dispose() { this.disposed=true; this.generation++; }
}
