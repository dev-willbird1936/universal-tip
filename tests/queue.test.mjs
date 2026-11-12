import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkQueue } from '../server/queue.mjs';

test('queue bounds concurrency, preserves FIFO and rejects overload', async () => {
  const queue = new WorkQueue({ concurrency: 1, maxWaiting: 1 }); let release; const order = [];
  const first = queue.run(() => new Promise(resolve => { order.push('first'); release = resolve; }));
  const second = queue.run(() => { order.push('second'); return 2; }, () => order.push('waiting'));
  await assert.rejects(queue.run(() => 3), error => error.code === 'QUEUE_FULL');
  await Promise.resolve(); assert.deepEqual(order, ['waiting', 'first']);
  release(1); assert.equal(await first, 1); assert.equal(await second, 2); assert.deepEqual(order, ['waiting', 'first', 'second']);
});
test('clearing the queue rejects waiting work without starting it', async () => {
  const queue = new WorkQueue({ concurrency: 1, maxWaiting: 2 }); let release; let ran = false;
  const active = queue.run(() => new Promise(resolve => { release = resolve; }));
  const pending = queue.run(() => { ran = true; }); const rejected = assert.rejects(pending, /Cache was cleared/);
  await Promise.resolve(); queue.cancelPending(); await rejected; assert.equal(ran, false);
  release(); await active;
});
