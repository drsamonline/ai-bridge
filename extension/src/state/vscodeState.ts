/**
 * VS Code implementations for the state layer.
 *
 * The state directory lives outside `workspace.fs`'s interest (it may be global),
 * so these use `node:fs` directly; the key lives in `SecretStorage`, never on
 * disk and never in settings.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import type { CipherPort, StateFsPort } from './store';

export function nodeStateFs(): StateFsPort {
  return {
    async read(p) {
      try {
        return await fs.readFile(p);
      } catch {
        return null;
      }
    },
    async write(p, data) {
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, data, { mode: 0o600 });
    },
    async rename(from, to) {
      await fs.rename(from, to);
    },
    async remove(p) {
      await fs.rm(p, { force: true });
    },
    async list(dir) {
      try {
        return await fs.readdir(dir);
      } catch {
        return [];
      }
    },
    async mkdir(dir) {
      await fs.mkdir(dir, { recursive: true });
    },
    async stat(p) {
      try {
        const s = await fs.stat(p);
        return { size: s.size, mtimeMs: s.mtimeMs };
      } catch {
        return null;
      }
    },
  };
}

const KEY_ID = 'aiBridge.stateKey';

/**
 * AES-256-GCM with a 32-byte key held in SecretStorage. The frame is
 * iv(12) || tag(16) || ciphertext, so a wrong key fails the tag check rather
 * than producing plausible garbage.
 */
export async function secretCipher(
  secrets: vscode.SecretStorage,
  log: (level: 'info' | 'warn' | 'error', msg: string) => void,
): Promise<CipherPort> {
  let hex = await secrets.get(KEY_ID);
  if (!hex || !/^[0-9a-f]{64}$/.test(hex)) {
    const fresh = crypto.randomBytes(32);
    await secrets.store(KEY_ID, fresh.toString('hex'));
    hex = fresh.toString('hex');
    log('info', 'generated a state encryption key in SecretStorage');
  }
  const key = Buffer.from(hex, 'hex');

  return {
    async encrypt(data) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([c.update(data), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]);
    },
    async decrypt(data) {
      if (data.length < 29) throw new Error('EDECRYPT: frame too short');
      const iv = data.subarray(0, 12);
      const tag = data.subarray(12, 28);
      const body = data.subarray(28);
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
      d.setAuthTag(tag);
      return Buffer.concat([d.update(body), d.final()]);
    },
  };
}

/**
 * `workspace` → `<root>/.ai-bridge/state`, `global` → `~/.ai-bridge/state/<hash>`.
 * The workspace variant gets a `.gitignore` so a user never commits their state.
 */
export async function resolveStateDir(
  location: 'workspace' | 'global',
  root: string | null,
): Promise<string> {
  if (location === 'workspace' && root) {
    const dir = path.join(root, '.ai-bridge', 'state');
    await fs.mkdir(dir, { recursive: true });
    const ignore = path.join(root, '.ai-bridge', '.gitignore');
    await fs
      .writeFile(ignore, '# AI Bridge local state — do not commit\n*\n', { flag: 'wx' })
      .catch(() => undefined);
    return dir;
  }
  const hash = crypto.createHash('sha256').update(root ?? 'global').digest('hex').slice(0, 12);
  const dir = path.join(os.homedir(), '.ai-bridge', 'state', hash);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
