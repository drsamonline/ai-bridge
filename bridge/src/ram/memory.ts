/**
 * Process memory sampling.
 *
 * The pid list comes from CDP (`SystemInfo.getProcessInfo`), which is exact and
 * platform-independent. Only the resident-set read is OS-specific:
 *
 *   linux   /proc/<pid>/statm  (pages x page size)
 *   darwin  ps -o pid=,rss= -p <pids>   (KiB)
 *   win32   Get-Process | Select Id,WorkingSet64
 *
 * When no source is usable the sample is reported as `unavailable` with zeros
 * rather than silently claiming 0 MB of usage.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type { MemorySource } from '@ai-bridge/shared';

export interface RssReading {
  byPid: Map<number, number>;
  source: MemorySource;
  note?: string;
}

const PAGE_SIZE = 4096; // 4 KiB on every platform we target

/** Proportional set size — the only per-process figure that can be summed. */
function readPss(pid: number): number | null {
  try {
    const roll = fs.readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
    const m = roll.match(/^Pss:\s+(\d+) kB/m);
    return m ? Number.parseInt(m[1]!, 10) * 1024 : null;
  } catch {
    return null;
  }
}

/** { rss, shared } in bytes, from statm. `shared` is 0 on kernels that omit it. */
function readStatm(pid: number): { rss: number; shared: number } | null {
  try {
    const f = fs.readFileSync(`/proc/${pid}/statm`, 'utf8').trim().split(/\s+/);
    const rss = Number.parseInt(f[1] ?? '0', 10) * PAGE_SIZE;
    const shared = Number.parseInt(f[2] ?? '0', 10) * PAGE_SIZE;
    return Number.isFinite(rss) ? { rss, shared: Number.isFinite(shared) ? shared : 0 } : null;
  } catch {
    return null;
  }
}

function linuxRss(pids: number[]): RssReading {
  const byPid = new Map<number, number>();
  let missing = 0;

  // 1. PSS if the kernel exposes it: sum is the true footprint.
  const pss = new Map<number, number>();
  for (const pid of pids) {
    const v = readPss(pid);
    if (v !== null) pss.set(pid, v);
  }
  if (pss.size === pids.length && pss.size > 0) {
    for (const [pid, bytes] of pss) byPid.set(pid, bytes);
    return { byPid, source: 'procfs-pss' };
  }

  // 2. RSS with a shared-page correction: private pages once each, shared pages
  //    once (approximated by the largest mapping).
  const statm = new Map<number, { rss: number; shared: number }>();
  for (const pid of pids) {
    const v = readStatm(pid);
    if (v) statm.set(pid, v);
    else missing += 1;
  }
  if (statm.size === 0) {
    return { byPid, source: 'unavailable', note: 'no readable /proc entries' };
  }
  let privateTotal = 0;
  let maxShared = 0;
  for (const [pid, v] of statm) {
    byPid.set(pid, v.rss);
    privateTotal += Math.max(0, v.rss - v.shared);
    maxShared = Math.max(maxShared, v.shared);
  }
  if (maxShared > 0) {
    return {
      byPid,
      source: 'procfs-rss-adj',
      note: 'PSS unavailable; estimated as private pages + largest shared mapping',
    };
  }

  // 3. Nothing to correct with: report the raw sum, labelled as an upper bound.
  return {
    byPid,
    source: 'procfs-rss',
    note:
      'PSS and shared-page accounting unavailable on this kernel; ' +
      'this is an RSS upper bound (shared pages counted per process)',
  };
}

function darwinRss(pids: number[]): RssReading {
  const byPid = new Map<number, number>();
  if (pids.length === 0) return { byPid, source: 'ps' };
  try {
    const out = execFileSync('ps', ['-o', 'pid=,rss=', '-p', pids.join(',')], {
      encoding: 'utf8',
      timeout: 2000,
    });
    for (const line of out.split('\n')) {
      const [pidRaw, kbRaw] = line.trim().split(/\s+/);
      const pid = Number.parseInt(pidRaw ?? '', 10);
      const kb = Number.parseInt(kbRaw ?? '', 10);
      if (Number.isFinite(pid) && Number.isFinite(kb)) byPid.set(pid, kb * 1024);
    }
    return { byPid, source: 'ps' };
  } catch (err) {
    return { byPid, source: 'unavailable', note: (err as Error).message };
  }
}

function windowsRss(pids: number[]): RssReading {
  const byPid = new Map<number, number>();
  if (pids.length === 0) return { byPid, source: 'powershell' };
  try {
    const script =
      `Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ` +
      'Select-Object Id,WorkingSet64 | ConvertTo-Json -Compress';
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      timeout: 4000,
    }).trim();
    if (out) {
      const parsed = JSON.parse(out);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      for (const row of rows as Array<{ Id: number; WorkingSet64: number }>) {
        byPid.set(row.Id, row.WorkingSet64);
      }
    }
    return { byPid, source: 'powershell' };
  } catch (err) {
    return { byPid, source: 'unavailable', note: (err as Error).message };
  }
}

export function readRss(pids: number[]): RssReading {
  const unique = [...new Set(pids.filter((p) => Number.isInteger(p) && p > 0))];
  if (unique.length === 0) {
    return { byPid: new Map(), source: 'unavailable', note: 'no pids supplied' };
  }
  switch (os.platform()) {
    case 'linux':
      return linuxRss(unique);
    case 'darwin':
      return darwinRss(unique);
    case 'win32':
      return windowsRss(unique);
    default:
      return { byPid: new Map(), source: 'unavailable', note: `unsupported platform ${os.platform()}` };
  }
}

/**
 * Fallback pid discovery when `SystemInfo.getProcessInfo` is refused: find the
 * process carrying the debugging flag, then walk its descendants.
 * Linux and macOS only; Windows falls back to a name match.
 */
export function findBrowserRootPid(port: number): number | null {
  const needle = `--remote-debugging-port=${port}`;
  try {
    if (os.platform() === 'linux') {
      for (const entry of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(entry)) continue;
        try {
          const cmd = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8');
          if (cmd.includes(needle)) return Number.parseInt(entry, 10);
        } catch {
          /* process vanished */
        }
      }
      return null;
    }
    if (os.platform() === 'darwin') {
      const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', timeout: 3000 });
      for (const line of out.split('\n')) {
        if (line.includes(needle)) {
          const pid = Number.parseInt(line.trim().split(/\s+/)[0] ?? '', 10);
          if (Number.isFinite(pid)) return pid;
        }
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Sum RSS over the browser's process tree (root + descendants). */
export function treeRss(rootPid: number): RssReading {
  if (os.platform() !== 'linux') {
    return readRss([rootPid]);
  }
  const children = new Map<number, number[]>();
  const all: number[] = [];
  try {
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number.parseInt(entry, 10);
      try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        // comm may contain spaces/parens; ppid is the 2nd field after the last ')'
        const tail = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        const ppid = Number.parseInt(tail[1] ?? '', 10);
        if (!Number.isFinite(ppid)) continue;
        all.push(pid);
        const list = children.get(ppid) ?? [];
        list.push(pid);
        children.set(ppid, list);
      } catch {
        /* vanished */
      }
    }
  } catch {
    return readRss([rootPid]);
  }
  const tree: number[] = [];
  const stack = [rootPid];
  while (stack.length) {
    const pid = stack.pop()!;
    if (tree.includes(pid)) continue;
    tree.push(pid);
    for (const kid of children.get(pid) ?? []) stack.push(kid);
  }
  return readRss(tree);
}
