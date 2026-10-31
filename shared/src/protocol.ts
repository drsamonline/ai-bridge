/** AI Bridge — protocol constants shared by bridge and extension. */

export const PROTOCOL_VERSION = 1;

/** Loopback only. The bridge never binds another interface. */
export const BIND_HOST = '127.0.0.1' as const;

/** Default port; `aiBridge.bridge.port` overrides it. */
export const DEFAULT_PORT = 47615;

/** Directory + file holding the port and token (spec §0.1). */
export const LOCK_DIR_NAME = '.ai-bridge';
export const LOCK_FILE_NAME = 'lock.json';
export const LOCK_FILE_MODE = 0o600;
export const LOCK_DIR_MODE = 0o700;

/**
 * Batch 9.5 — the local-socket transport.
 *
 * The socket's own permissions are the authentication: 0600 on POSIX, and a
 * named pipe whose DACL admits only the creating user on Windows. That is what
 * lets the token stop being a file on disk, which is the only thing that made
 * Windows unsafe to support.
 */
export const SOCKET_FILE_NAME = 'bridge.sock';
export const SOCKET_MODE = 0o600;

/** Handshake request/response correlation id. */
export const HANDSHAKE_ID = 'handshake';

export const CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  UNAUTHORIZED: 4001,
  PROTOCOL_ERROR: 4002,
  TIMEOUT: 4003,
  REPLACED: 4004,
} as const;

export const ERRORS = {
  ENOTIMPL: 'ENOTIMPL',
  EAUTH: 'EAUTH',
  EPROTO: 'EPROTO',
  ETIMEOUT: 'ETIMEOUT',
  ERAMBLOCK: 'ERAMBLOCK',
  ENOCDP: 'ENOCDP',
  ENOTATTACHED: 'ENOTATTACHED',
} as const;

/** Heartbeat interval for the bridge's dead-socket sweep. */
export const HEARTBEAT_MS = 30_000;

/** Upper bound on a single inbound frame. Prompts are big; 8 MB is generous. */
export const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;

/** Handshake data returned by `{ op: 'result', id: 'handshake' }`. */
export interface HandshakeData {
  bridge: {
    pid: number;
    version: string;
    protocol: number;
    startedAt: number;
    uptimeMs: number;
  };
  /** First 12 hex chars of sha256(token) — proof of key agreement, not the key. */
  tokenFingerprint: string;
  capabilities: string[];
}
