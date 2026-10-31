/**
 * Bridge entry point — batch 0.1.
 *
 * 1. Generate a fresh 32-byte token for this process.
 * 2. Bind 127.0.0.1 on the configured port (falling forward if busy).
 * 3. Publish { port, token } to ~/.ai-bridge/lock.json at 0600.
 * 4. Serve the `attach` handshake; log every transition to stdout.
 * 5. On exit, remove the lock — but only if it is still ours.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  clearLock,
  isPidAlive,
  lockDir,
  lockPath,
  readLock,
  socketPath,
  writeLock,
  type LockFile,
} from '@ai-bridge/shared';
import { startBridgeServer, type BridgeServer } from './server';
import { createLogger, ensureLogFile, type Level } from './logger';
import { BridgeRuntime } from './runtime';
import { DEFAULT_PORTS } from './cdp/discovery';

const VERSION = readOwnVersion();

function readOwnVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    return String(pkg.version ?? '0.1.0');
  } catch {
    return '0.1.0';
  }
}

function parsePorts(): number[] {
  const raw = process.env.AI_BRIDGE_CDP_PORTS;
  if (!raw) return [...DEFAULT_PORTS];
  const ports = raw
    .split(',')
    .map((p) => Number.parseInt(p.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
  return ports.length ? ports : [...DEFAULT_PORTS];
}

function parseRamCap(): number {
  const mb = Number.parseInt(process.env.AI_BRIDGE_RAM_CAP_MB ?? '', 10);
  return Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : 500 * 1024 * 1024;
}

function parsePort(): number {
  const raw = process.env.AI_BRIDGE_PORT;
  if (!raw) return DEFAULT_PORT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`AI_BRIDGE_PORT is not a valid port: ${raw}`);
  }
  return n;
}

async function main(): Promise<void> {
  const home = process.env.AI_BRIDGE_HOME || os.homedir();
  const dir = lockDir(home);
  const logFile = ensureLogFile(path.join(dir, 'bridge.log'));
  const log = createLogger({
    level: (process.env.AI_BRIDGE_LOG_LEVEL as Level | undefined) ?? 'info',
    file: logFile,
  });

  log.info(`AI Bridge starting`, { version: VERSION, node: process.version, pid: process.pid, home });

  // Single-instance guard: never clobber a live bridge's lock.
  try {
    const existing = readLock(dir).lock;
    if (existing.pid !== process.pid && isPidAlive(existing.pid)) {
      log.error('another bridge is already running — refusing to start', {
        pid: existing.pid,
        port: existing.port,
      });
      process.exit(3);
    }
    log.warn('clearing stale lock file', { pid: existing.pid, alive: isPidAlive(existing.pid) });
    clearLock(existing.pid, dir);
  } catch (err) {
    log.debug('no usable existing lock', { reason: (err as Error).message });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const requestedPort = parsePort();
  const startedAt = Date.now();

  const runtime = new BridgeRuntime({
    log,
    ports: parsePorts(),
    ramCapBytes: parseRamCap(),
    pollMs: Number.parseInt(process.env.AI_BRIDGE_POLL_MS ?? '', 10) || 3000,
  });

  let server: BridgeServer | null = null;
  let port = requestedPort;
  for (let attempt = 0; attempt < 12 && !server; attempt++) {
    try {
      server = await startBridgeServer({ port, token, version: VERSION, log, runtime, startedAt });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE') {
        log.warn(`port ${port} busy — trying ${port + 1}`);
        port += 1;
        continue;
      }
      log.error(`bind failed: ${(err as Error).message}`);
      throw err;
    }
  }
  if (!server) {
    log.error('no free port in range — giving up');
    process.exit(4);
  }

  const useTcp = process.env.AI_BRIDGE_TRANSPORT === 'tcp';
  const lock: LockFile = {
    v: 1,
    host: '127.0.0.1',
    port: server.port,
    // Batch 9.5: the socket is the transport and its permissions are the
    // authorisation, so no credential is written down. The token survives only
    // for the TCP fallback, where nothing else separates one local user from
    // another.
    socket: socketPath(home),
    ...(useTcp ? { token } : {}),
    pid: process.pid,
    startedAt,
    version: VERSION,
    protocol: PROTOCOL_VERSION,
  };
  const lockFile = writeLock(lock, dir);
  const stat = fs.statSync(lockFile);
  log.info('lock file written', {
    path: lockFile,
    mode: `0${(stat.mode & 0o777).toString(8)}`,
    port: lock.port,
  });
  log.info('bridge ready', { address: server.address, hint: 'waiting for { op: "attach" }' });
  runtime.start();

  // Machine-readable ready line for supervisors/tests (never contains the token).
  process.stdout.write(
    `AI_BRIDGE_READY ${JSON.stringify({ port: lock.port, pid: process.pid, lock: lockPath(home) })}\n`,
  );

  const shutdown = async (signal: string) => {
    log.info(`shutting down (${signal})`);
    try {
      // Detach from CDP first: this disconnects, it never kills the browser.
      await runtime.stop();
    } catch (err) {
      log.warn(`runtime stop error: ${(err as Error).message}`);
    }
    try {
      await server!.close();
    } catch (err) {
      log.warn(`close error: ${(err as Error).message}`);
    }
    if (clearLock(process.pid, dir)) log.info('lock file removed');
    // Batch 9.5: the socket outlives the process otherwise, and the next start
    // would find a dead one. Windows pipes vanish with their last handle.
    if (process.platform !== 'win32') {
      try {
        fs.unlinkSync(socketPath(home));
        log.info('socket removed');
      } catch {
        /* already gone */
      }
    }
    else log.warn('lock file left in place (not ours or already gone)');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    log.error(`uncaught: ${err.stack ?? err.message}`);
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    log.error(`unhandled rejection: ${String(reason)}`);
  });
}

main().catch((err) => {
  process.stderr.write(`AI Bridge failed to start: ${(err as Error).message}\n`);
  process.exit(1);
});
