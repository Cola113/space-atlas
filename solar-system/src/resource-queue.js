// Shared admission control for scene resources. Completed values are reused;
// failed requests are removed so a deliberate retry creates a new request.
export class ResourceQueue {
  constructor(concurrency = 4) {
    this.concurrency = concurrency;
    this.entries = new Map();
    this.active = 0;
    this.sequence = 0;
    this.closed = false;
    this.paused = false;
    this.peak = 0;
  }

  run(key, task, { priority = 0, timeout = 15000, preempt = false } = {}) {
    if (this.closed) return Promise.reject(new Error('Resource queue disposed'));
    const existing = this.entries.get(key);
    if (existing) {
      existing.priority = Math.max(existing.priority, priority);
      if (preempt && existing.status === 'queued') this.makeRoom(existing);
      this.pump();
      return existing.promise;
    }
    const entry = { key, task, priority, timeout, order: this.sequence++, status: 'queued', controller: new AbortController() };
    entry.promise = new Promise((resolve, reject) => Object.assign(entry, { resolve, reject }));
    this.entries.set(key, entry);
    if (preempt) this.makeRoom(entry);
    this.pump();
    return entry.promise;
  }

  makeRoom(urgent) {
    if (this.active < this.concurrency || [...this.entries.values()].some(entry => entry.preempted)) return;
    const lower = [...this.entries.values()].filter(entry => entry.status === 'active' && entry.priority < urgent.priority)
      .sort((a, b) => a.priority - b.priority)[0];
    if (lower) {
      lower.preempted = true;
      lower.controller.abort(new Error('Resource yielded to explicit retry'));
    }
  }

  reprioritize(key, priority) {
    const entry = this.entries.get(key);
    if (entry) entry.priority = priority;
    this.pump();
  }

  setConcurrency(value) {
    if (!Number.isInteger(value) || value < 1) throw new Error('Invalid concurrency');
    this.concurrency = value;
    this.pump();
  }

  setPaused(value) { this.paused = value; this.pump(); }
  forget(key) { if (this.entries.get(key)?.status === 'complete') this.entries.delete(key); }

  pump() {
    if (this.closed || this.paused) return;
    while (this.active < this.concurrency) {
      const entry = [...this.entries.values()].filter(item => item.status === 'queued')
        .sort((a, b) => b.priority - a.priority || a.order - b.order)[0];
      if (!entry) break;
      entry.status = 'active';
      this.active++;
      this.peak = Math.max(this.peak, this.active);
      const timer = setTimeout(() => entry.controller.abort(new Error('Resource timed out')), entry.timeout);
      const signal = entry.controller.signal;
      // Fetch observes this abort, including while consuming its body. A task
      // must also release any decoded resource if aborted before returning it.
      Promise.resolve().then(() => { signal.throwIfAborted(); return entry.task(signal); })
        .then(value => {
          signal.throwIfAborted();
          entry.status = 'complete';
          entry.resolve(value);
        }).catch(error => {
          if (entry.preempted && !this.closed) {
            // Keep the original subscribers and retry the yielded download
            // after urgent work. An intentional yield is not a user error.
            entry.preempted = false;
            entry.controller = new AbortController();
            entry.status = 'queued';
            return;
          }
          this.entries.delete(entry.key);
          entry.status = 'failed';
          entry.reject(error);
        }).finally(() => {
          clearTimeout(timer);
          this.active--;
          this.pump();
        });
    }
  }

  snapshot() {
    const entries = [...this.entries.values()];
    return { concurrency: this.concurrency, active: this.active, peak: this.peak,
      queued: entries.filter(entry => entry.status === 'queued').map(({ key, priority }) => ({ key, priority })),
      complete: entries.filter(entry => entry.status === 'complete').length };
  }

  dispose() {
    this.closed = true;
    for (const entry of this.entries.values()) {
      entry.controller.abort(new Error('Resource queue disposed'));
      if (entry.status === 'queued') entry.reject(entry.controller.signal.reason);
    }
    this.entries.clear();
  }
}

// One potentially expensive creation/upload per scene frame. Work that cannot
// yet be seen waits without blocking useful work for another body.
export class FrameWorkQueue {
  constructor() { this.entries = new Map(); this.sequence = 0; this.closed = false; }
  run(key, work, { priority = 0, visible = () => true } = {}) {
    if (this.closed) return Promise.reject(new Error('Frame queue disposed'));
    const existing = this.entries.get(key);
    if (existing) { existing.priority = priority; return existing.promise; }
    const entry = { key, work, priority, visible, order: this.sequence++ };
    entry.promise = new Promise((resolve, reject) => Object.assign(entry, { resolve, reject }));
    this.entries.set(key, entry);
    return entry.promise;
  }
  reprioritize(key, priority) { const entry = this.entries.get(key); if (entry) entry.priority = priority; }
  drainOne() {
    const entry = [...this.entries.values()].filter(item => item.visible())
      .sort((a, b) => b.priority - a.priority || a.order - b.order)[0];
    if (!entry) return false;
    this.entries.delete(entry.key);
    try { entry.resolve(entry.work()); } catch (error) { entry.reject(error); }
    return true;
  }
  dispose() {
    this.closed = true;
    for (const entry of this.entries.values()) entry.reject(new Error('Frame queue disposed'));
    this.entries.clear();
  }
}
