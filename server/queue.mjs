export class WorkQueue {
  constructor({ concurrency = 4, maxWaiting = 16 } = {}) {
    this.concurrency = concurrency; this.maxWaiting = maxWaiting; this.active = 0; this.waiting = [];
  }
  run(task, onWaiting = () => {}) {
    return new Promise((resolve, reject) => {
      const item = { task, resolve, reject };
      if (this.active < this.concurrency) this.start(item);
      else if (this.waiting.length < this.maxWaiting) { this.waiting.push(item); try { onWaiting(); } catch { /* Progress reporting cannot affect queued work. */ } }
      else { const error = new Error('Research queue is full; try again shortly.'); error.code = 'QUEUE_FULL'; reject(error); }
    });
  }
  start(item) {
    this.active++;
    Promise.resolve().then(item.task).then(item.resolve, item.reject).finally(() => {
      this.active--;
      if (this.waiting.length) this.start(this.waiting.shift());
    });
  }
  cancelPending() {
    const pending = this.waiting.splice(0);
    for (const item of pending) item.reject(new Error('Cache was cleared while this lookup was waiting; try again.'));
  }
}
