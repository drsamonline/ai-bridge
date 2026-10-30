/**
 * Lock file: the ONLY channel through which the extension learns the bridge's
 * port and token.
 *
 * Location : ~/.ai-bridge/lock.json   (dir 0700)
 * Mode     : 0600, enforced on write and re-checked on read
 * Write    : temp file -> chmod -> fsync -> rename (atomic; readers never see
 *            a half-written token)
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LOCK_DIR_MODE, LOCK_DIR_NAME, LOCK_FILE_MODE, LOCK_FILE_NAME } from './protocol';

export interface LockFile {
  /** Lock schema version — independent of ProjectState.v and of PROTOCOL_VERSION. */
  v: 1;
  host: '127.0.0.1';
  port: number;
  token: string;
  pid: number;
  startedAt: number;
  version: string;
  protocol: number;
}

export function defaultHome(): string {
  // AI_BRIDGE_HOME keeps the lock out of the real home in tests and portable installs.
  return process.env.AI_BRIDGE_HOME || os.homedir();
}

export function lockDir(home: string = defaultHome()): string {
  return path.join(home, LOCK_DIR_NAME);
}

export function lockPath(home: string = defaultHome()): string {
  return path.join(lockDir(home), LOCK_FILE_NAME);
}

export class LockError extends Error {
  constructor(
    message: string,
    readonly code: 'EBADMODE' | 'EBADSHAPE' | 'EWRITE' | 'ENOENT',
  ) {
    super(message);
    this.name = 'LockError';
  }
}

/** Create the lock directory (0700) if needed and tighten its mode. */
export function ensureLockDir(dir: string = lockDir()): string {
  fs.mkdirSync(dir, { recursive: true, mode: LOCK_DIR_MODE });
  try {
    fs.chmodSync(dir, LOCK_DIR_MODE);
  } catch {
    // Best effort: some filesystems (network mounts) refuse chmod.
  }
  return dir;
}

/** Atomically write the lock file with mode 0600. */
export function writeLock(data: LockFile, dir: string = lockDir()): string {
  ensureLockDir(dir);
  const target = path.join(dir, LOCK_FILE_NAME);
  const tmp = path.join(dir, `${LOCK_FILE_NAME}.${process.pid}.${Date.now()}.tmp`);
  const body = JSON.stringify(data, null, 2) + '\n';

  let fd: number | undefined;
  try {
    fd = fs.openSync(tmp, 'wx', LOCK_FILE_MODE);
    fs.fchmodSync(fd, LOCK_FILE_MODE);
    fs.writeFileSync(fd, body, 'utf8');
    fs.fsyncSync(fd);
  } catch (err) {
    if (fd !== undefined) fs.closeSync(fd);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw new LockError(`cannot write lock file: ${(err as Error).message}`, 'EWRITE');
  }
  fs.closeSync(fd);

  fs.renameSync(tmp, target);
  try {
    fs.chmodSync(target, LOCK_FILE_MODE);
  } catch {
    /* best effort */
  }
  return target;
}

export interface ReadLockResult {
  lock: LockFile;
  /** Permission bits actually observed on disk (e.g. 0o600). */
  mode: number;
  path: string;
}

/**
 * Read and validate the lock file.
 *
 * A lock that is world- or group-readable is REFUSED, not silently accepted:
 * the token is the bridge's only credential.
 */
export function readLock(dir: string = lockDir()): ReadLockResult {
  const target = path.join(dir, LOCK_FILE_NAME);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    throw new LockError(`no lock file at ${target}`, 'ENOENT');
  }

  const mode = stat.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new LockError(
      `lock file mode is 0${mode.toString(8)} — refusing to read; expected 0600`,
      'EBADMODE',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (err) {
    throw new LockError(`lock file is not valid JSON: ${(err as Error).message}`, 'EBADSHAPE');
  }

  const lock = validateLock(parsed);
  return { lock, mode, path: target };
}

export function validateLock(value: unknown): LockFile {
  const o = value as Partial<LockFile> | null;
  const bad = (why: string) =>
    new LockError(`lock file shape invalid: ${why}`, 'EBADSHAPE');

  if (typeof o !== 'object' || o === null) throw bad('not an object');
  if (o.v !== 1) throw bad(`v must be 1, got ${String(o.v)}`);
  if (o.host !== '127.0.0.1') throw bad(`host must be 127.0.0.1, got ${String(o.host)}`);
  if (typeof o.port !== 'number' || !Number.isInteger(o.port) || o.port < 1 || o.port > 65535)
    throw bad(`port invalid: ${String(o.port)}`);
  if (typeof o.token !== 'string' || !/^[0-9a-f]{64}$/.test(o.token))
    throw bad('token must be 64 hex chars');
  if (typeof o.pid !== 'number' || !Number.isInteger(o.pid) || o.pid < 1)
    throw bad(`pid invalid: ${String(o.pid)}`);
  if (typeof o.startedAt !== 'number') throw bad('startedAt must be a number');
  if (typeof o.version !== 'string') throw bad('version must be a string');
  if (typeof o.protocol !== 'number') throw bad('protocol must be a number');
  return o as LockFile;
}

/** Remove the lock, but only if it still belongs to `pid`. */
export function clearLock(pid: number, dir: string = lockDir()): boolean {
  const target = path.join(dir, LOCK_FILE_NAME);
  try {
    const { lock } = readLock(dir);
    if (lock.pid !== pid) return false;
    fs.unlinkSync(target);
    return true;
  } catch {
    return false;
  }
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
