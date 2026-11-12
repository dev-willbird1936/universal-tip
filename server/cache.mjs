import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Optional encrypted local registry. The key remains in the server environment, never in the extension.
export class EvidenceCache {
  constructor({ key = '', directory = path.resolve('data'), maxEntries = 500 } = {}) {
    if (key && !/^[a-f\d]{64}$/i.test(key)) throw new Error('CACHE_ENCRYPTION_KEY must be 64 hexadecimal characters');
    this.key = key ? Buffer.from(key, 'hex') : null;
    this.file = path.join(directory, 'evidence-cache.enc'); this.records = new Map(); this.maxEntries = maxEntries;
    this.queue = Promise.resolve(); this.persistenceError = false;
  }
  async load() {
    if (!this.key) return;
    try {
      const data = await readFile(this.file); if (data.length < 29 || data.length > 32 * 1024 * 1024 || data[0] !== 1) throw new Error('Invalid cache');
      const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(1, 13)); decipher.setAuthTag(data.subarray(13, 29));
      const records = JSON.parse(Buffer.concat([decipher.update(data.subarray(29)), decipher.final()]).toString('utf8'));
      if (!Array.isArray(records)) throw new Error('Invalid cache');
      this.records = new Map(records.filter(entry => Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].length <= 2048 && Number.isFinite(entry[1]?.expires) && entry[1].expires > Date.now() && Buffer.byteLength(JSON.stringify(entry[1]), 'utf8') <= 32768).slice(-this.maxEntries));
      if (this.records.size !== records.length) await this.persist();
    } catch (error) { if (error.code !== 'ENOENT') { this.persistenceError = true; throw new Error('Encrypted cache could not be opened; check its key and preserve the file.'); } }
  }
  get(key) { const item = this.records.get(key); return item?.expires > Date.now() ? item.value : null; }
  async set(key, value, expires) {
    if (typeof key !== 'string' || key.length > 2048 || !Number.isFinite(expires)) throw new Error('Invalid cache key or expiry');
    if (Buffer.byteLength(JSON.stringify({ value, expires }), 'utf8') > 32768) throw new Error('Result exceeds cache record size limit');
    if (this.records.size >= this.maxEntries && !this.records.has(key)) this.records.delete(this.records.keys().next().value);
    this.records.set(key, { value, expires }); await this.persist();
  }
  async hasLockedRegistry() {
    if (this.key) return false;
    try { await access(this.file); return true; } catch (error) { return error.code !== 'ENOENT'; }
  }
  async clear() {
    this.records.clear();
    if (await this.hasLockedRegistry()) throw new Error('Encrypted registry is locked; set CACHE_ENCRYPTION_KEY and restart before clearing it.');
    await this.persist();
  }
  async prune() {
    let changed = false;
    for (const [key, item] of this.records) if (item.expires <= Date.now()) { this.records.delete(key); changed = true; }
    if (changed) await this.persist();
  }
  async persist() {
    if (!this.key) return;
    const snapshot = JSON.stringify([...this.records]);
    this.queue = this.queue.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
      const ciphertext = Buffer.concat([cipher.update(snapshot), cipher.final()]);
      const data = Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), ciphertext]);
      const temp = `${this.file}.${randomBytes(8).toString('hex')}.tmp`;
      await writeFile(temp, data, { mode: 0o600, flag: 'wx' }); await rename(temp, this.file);
    });
    try { await this.queue; this.persistenceError = false; } catch { this.persistenceError = true; throw new Error('Encrypted cache could not be saved'); }
  }
}
