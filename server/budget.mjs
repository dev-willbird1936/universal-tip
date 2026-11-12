import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Conservatively reserve calls before making them; failed calls still consume quota.
export class DailyCallBudget {
  constructor({ limit, maxReservedCents = 0, directory = path.resolve('data'), allowZeroCost = false, fileName = 'provider-call-budget.json' }) {
    this.limit = limit; this.maxReservedCents = maxReservedCents; this.allowZeroCost = allowZeroCost; this.directory = directory; this.file = path.join(directory, fileName);
    this.queue = Promise.resolve();
  }
  async reserve(costCents) {
    const free = this.allowZeroCost && costCents === 0;
    if (!this.limit || !Number.isSafeInteger(costCents) || (!free && (!this.maxReservedCents || costCents < 1))) return false;
    const operation = this.queue.catch(() => {}).then(async () => {
      const day = new Date().toISOString().slice(0, 10); let previous; let exists = false;
      try { const raw = await readFile(this.file, 'utf8'); if (raw.length > 1024) throw new Error('Budget file too large'); previous = JSON.parse(raw); exists = true; }
      catch (error) { if (error.code !== 'ENOENT') throw new Error('Provider budget could not be read'); }
      if (exists && (!previous || typeof previous !== 'object' || Array.isArray(previous) || typeof previous.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(previous.day) || !Number.isSafeInteger(previous.calls) || previous.calls < 0)) throw new Error('Provider budget is invalid');
      if (exists) {
        const parsed = new Date(`${previous.day}T00:00:00.000Z`);
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== previous.day || previous.day > day) throw new Error('Provider budget date is invalid or in the future');
      }
      const today = previous?.day === day;
      if (today && (!Number.isSafeInteger(previous.reservedCents) || previous.reservedCents < 0)) throw new Error('Existing daily budget lacks spend reservations');
      const calls = today ? previous.calls : 0; const reservedCents = today ? previous.reservedCents : 0;
      if (calls >= this.limit || (!free && reservedCents + costCents > this.maxReservedCents)) return false;
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const temp = `${this.file}.${randomBytes(8).toString('hex')}.tmp`;
      await writeFile(temp, JSON.stringify({ day, calls: calls + 1, reservedCents: reservedCents + costCents }), { mode: 0o600, flag: 'wx' });
      await rename(temp, this.file);
      return true;
    });
    this.queue = operation;
    try { return await operation; } catch { return false; }
  }
}
