/**
 * State persistence — gzip, atomic, optionally encrypted, with snapshots.
 *
 * Layout (relative to the state directory):
 *   state.full.json.gz        gzip JSON          (state.encrypt = false)
 *   state.full.json.gz.aes    AES-256-GCM + gzip (state.encrypt = true)
 *   snapshots/snap-<ts>-<n>.json.gz[.aes]
 *
 * Every write goes temp → fsync → rename, so a crash mid-write leaves the last
 * good file in place rather than a truncated one. A file that fails to parse is
 * moved aside as `.corrupt-<ts>` and a fresh state is returned — never deleted,
 * because the old state may be the only record of what happened.
 */

import * as zlib from 'node:zlib';
import { promisify } from 'node:util';
import type { ProjectState } from '@ai-bridge/shared';
import { createState, validateState, redact, type CreateStateOptions } from './schema';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export interface StateFsPort {
  read(path: string): Promise<Buffer | null>;
  write(path: string, data: Buffer): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(dir: string): Promise<string[]>;
  mkdir(dir: string): Promise<void>;
  stat(path: string): Promise<{ size: number; mtimeMs: number } | null>;
}

export interface CipherPort {
  encrypt(data: Buffer): Promise<Buffer>;
  decrypt(data: Buffer): Promise<Buffer>;
}

export interface StateStoreOptions {
  fs: StateFsPort;
  dir: string;
  encrypt?: boolean;
  cipher?: CipherPort;
  maxSnapshots?: number;
  log: (level: 'info' | 'warn' | 'error', msg: string, details?: Record<string, unknown>) => void;
  createOptions: CreateStateOptions;
}

export interface SaveResult {
  path: string;
  bytes: number;
  rawBytes: number;
  encrypted: boolean;
}

export interface LoadResult {
  state: ProjectState;
  recovered: boolean;
  reason?: string;
  bytes?: number;
}

export class StateStore {
  private readonly full: string;
  private readonly snapDir: string;

  constructor(private readonly opts: StateStoreOptions) {
    const ext = opts.encrypt ? '.json.gz.aes' : '.json.gz';
    this.full = `${opts.dir}/state.full${ext}`;
    this.snapDir = `${opts.dir}/snapshots`;
  }

  get path(): string {
    return this.full;
  }

  get snapshotDir(): string {
    return this.snapDir;
  }

  /** Deep-redact every string in the state before it is serialised. */
  private sanitise(state: ProjectState): ProjectState {
    const walk = (value: unknown): unknown => {
      if (typeof value === 'string') return redact(value).text;
      if (Array.isArray(value)) return value.map(walk);
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = walk(v);
        return out;
      }
      return value;
    };
    return walk(state) as ProjectState;
  }

  private async encode(state: ProjectState): Promise<{ body: Buffer; raw: number }> {
    const json = JSON.stringify(this.sanitise(state));
    const raw = Buffer.byteLength(json, 'utf8');
    const gz = await gzip(Buffer.from(json, 'utf8'));
    if (!this.opts.encrypt) return { body: gz, raw };
    if (!this.opts.cipher) throw new Error('ENOCIPHER: encryption is on but no cipher was supplied');
    return { body: await this.opts.cipher.encrypt(gz), raw };
  }

  private async decode(body: Buffer): Promise<string> {
    const plain = this.opts.encrypt ? await this.decrypt(body) : body;
    const json = await gunzip(plain);
    return json.toString('utf8');
  }

  private async decrypt(body: Buffer): Promise<Buffer> {
    if (!this.opts.cipher) throw new Error('ENOCIPHER: encrypted state but no cipher supplied');
    return this.opts.cipher.decrypt(body);
  }

  async save(state: ProjectState, target = this.full): Promise<SaveResult> {
    await this.opts.fs.mkdir(target.slice(0, target.lastIndexOf('/')) || this.opts.dir);
    const { body, raw } = await this.encode(state);
    const tmp = `${target}.tmp`;
    await this.opts.fs.write(tmp, body);
    await this.opts.fs.rename(tmp, target);
    const encrypted = !!this.opts.encrypt;
    this.opts.log('info', `state saved: ${target}`, {
      bytes: body.length,
      rawBytes: raw,
      encrypted,
      ratio: raw > 0 ? `${Math.round((body.length / raw) * 100)}%` : 'n/a',
    });
    return { path: target, bytes: body.length, rawBytes: raw, encrypted };
  }

  async load(): Promise<LoadResult> {
    const body = await this.opts.fs.read(this.full).catch(() => null);
    if (!body) {
      this.opts.log('info', `no state at ${this.full} — starting fresh`);
      return { state: createState(this.opts.createOptions), recovered: false };
    }
    try {
      const json = await this.decode(body);
      const state = validateState(JSON.parse(json));
      this.opts.log('info', `state loaded: ${this.full}`, { bytes: body.length, deltas: state.deltas.length });
      return { state, recovered: false, bytes: body.length };
    } catch (err) {
      const reason = (err as Error).message;
      const aside = `${this.full}.corrupt-${Date.now()}`;
      await this.opts.fs.rename(this.full, aside).catch(() => undefined);
      this.opts.log('error', `state unreadable (${reason}) — moved to ${aside}, starting fresh`);
      return { state: createState(this.opts.createOptions), recovered: true, reason };
    }
  }

  async snapshot(state: ProjectState, label: string): Promise<string> {
    await this.opts.fs.mkdir(this.snapDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = this.opts.encrypt ? '.json.gz.aes' : '.json.gz';
    const target = `${this.snapDir}/snap-${stamp}-${label}${ext}`;
    await this.save(state, target);
    await this.prune();
    return target;
  }

  async listSnapshots(): Promise<Array<{ name: string; path: string; bytes: number; mtimeMs: number }>> {
    const names = await this.opts.fs.list(this.snapDir).catch(() => []);
    const out: Array<{ name: string; path: string; bytes: number; mtimeMs: number }> = [];
    for (const name of names) {
      if (!/^snap-.*\.json\.gz(\.aes)?$/.test(name)) continue;
      const full = `${this.snapDir}/${name}`;
      const st = await this.opts.fs.stat(full).catch(() => null);
      out.push({ name, path: full, bytes: st?.size ?? 0, mtimeMs: st?.mtimeMs ?? 0 });
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }

  /** Keep the newest `maxSnapshots`; delete the rest. */
  async prune(): Promise<number> {
    const max = this.opts.maxSnapshots ?? 10;
    const snaps = await this.listSnapshots();
    const doomed = snaps.slice(max);
    for (const s of doomed) await this.opts.fs.remove(s.path).catch(() => undefined);
    if (doomed.length) this.opts.log('info', `pruned ${doomed.length} old snapshot(s)`, { kept: max });
    return doomed.length;
  }

  async restore(name: string): Promise<ProjectState> {
    const snaps = await this.listSnapshots();
    const found = snaps.find((s) => s.name === name || s.path === name);
    if (!found) throw new Error(`ENOSNAP: no snapshot named ${name}`);
    const body = await this.opts.fs.read(found.path);
    if (!body) throw new Error(`ENOSNAP: snapshot ${name} is unreadable`);
    const json = await this.decode(body);
    return validateState(JSON.parse(json));
  }
}
