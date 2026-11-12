import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DailyCallBudget } from '../server/budget.mjs';

test('free-call quota persists independently and cannot consume a paid reservation', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ut-budget-free-'));
  try {
    const free = new DailyCallBudget({ limit: 1, allowZeroCost: true, directory: dir, fileName: 'free.json' });
    assert.equal(await free.reserve(0), true); assert.equal(await free.reserve(0), false);
    assert.equal(await new DailyCallBudget({ limit: 1, allowZeroCost: true, directory: dir, fileName: 'free.json' }).reserve(0), false);
    assert.equal(await free.reserve(1), false, 'A zero-cost quota must never reserve a paid request');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('daily call quota survives restart and fails closed on corrupted storage', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ut-budget-'));
  try {
    const first = new DailyCallBudget({ limit: 3, maxReservedCents: 15, directory: dir });
    assert.deepEqual(await Promise.all([first.reserve(7), first.reserve(7), first.reserve(7)]), [true, true, false]);
    const second = new DailyCallBudget({ limit: 3, maxReservedCents: 15, directory: dir }); assert.equal(await second.reserve(7), false);
    const file = path.join(dir, 'provider-call-budget.json'); const saved = JSON.parse(await readFile(file, 'utf8')); assert.equal(saved.calls, 2); assert.equal(saved.reservedCents, 14);
    await writeFile(file, JSON.stringify({ day: new Date().toISOString().slice(0, 10), calls: 1 })); assert.equal(await second.reserve(1), false, 'Old same-day budget without cost reservations must fail closed');
    for (const invalid of ['corrupt', 'null', 'false', '[]', JSON.stringify({ day: '9999-12-31', calls: 0, reservedCents: 0 }), JSON.stringify({ day: '2026-99-99', calls: 0, reservedCents: 0 })]) {
      await writeFile(file, invalid); assert.equal(await second.reserve(1), false, 'Corrupt or future-dated quota state must fail closed');
    }
    assert.equal(await second.reserve(0), false, 'Unknown per-call cost must fail closed');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
