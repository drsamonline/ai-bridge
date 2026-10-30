/**
 * Bridge logger.
 *
 * One line per event, always to stdout so the extension can pipe it straight
 * into the "AI Bridge" Output channel, and optionally to a file for support
 * bundles. No log line ever contains the token or a full frame body.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
  child(component: string): Logger;
}

export interface LoggerOptions {
  level?: Level;
  component?: string;
  /** Mirror to this file (append, created 0600). */
  file?: string;
  /** Test hook — defaults to process.stdout. */
  sink?: (line: string) => void;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const level = opts.level ?? (process.env.AI_BRIDGE_LOG_LEVEL as Level) ?? 'info';
  const min = ORDER[level] ?? ORDER.info;
  const sink = opts.sink ?? ((line: string) => process.stdout.write(line + '\n'));
  const file = opts.file;

  const write = (lvl: Level, component: string, msg: string, extra?: Record<string, unknown>) => {
    if (ORDER[lvl] < min) return;
    const ts = new Date().toISOString();
    const tail = extra && Object.keys(extra).length ? ' ' + safeJson(extra) : '';
    const line = `${ts} ${lvl.toUpperCase().padEnd(5)} [${component}] ${msg}${tail}`;
    sink(line);
    if (file) {
      try {
        fs.appendFileSync(file, line + '\n', { mode: 0o600 });
      } catch {
        // Logging must never take the bridge down.
      }
    }
  };

  const build = (component: string): Logger => ({
    debug: (m, e) => write('debug', component, m, e),
    info: (m, e) => write('info', component, m, e),
    warn: (m, e) => write('warn', component, m, e),
    error: (m, e) => write('error', component, m, e),
    child: (sub) => build(`${component}:${sub}`),
  });

  return build(opts.component ?? 'bridge');
}

function safeJson(v: Record<string, unknown>): string {
  try {
    return JSON.stringify(v);
  } catch {
    return '{"extra":"<unserialisable>"}';
  }
}

export function ensureLogFile(file: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, '', { mode: 0o600 });
  return file;
}
