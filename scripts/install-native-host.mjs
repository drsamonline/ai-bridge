#!/usr/bin/env node
/**
 * Native messaging host installer — the per-OS registration the A shell needs.
 *
 * Chrome will only launch a native host it has been told about, and where that
 * registration lives differs on all three platforms. This generates the manifest
 * and, where it can, writes it; on Windows the registration is a registry key, so it
 * prints the exact command instead of pretending to be portable.
 *
 * The three facts this encodes, each of which breaks the setup if wrong:
 *
 *  1. `allowed_origins` must name the extension id exactly, with a trailing slash.
 *  2. The manifest's `path` must be an absolute path to an executable.
 *  3. On Windows the host must be a real `.exe` — Chrome refuses a `.cmd` or a
 *     batch file, so a Node script needs a launcher binary.
 *
 * Run with no arguments to print; `--write` to install for the current platform.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const HOST_NAME = 'com.drsamonline.ai_bridge_debate';

/** Where Chrome looks for the host manifest, per platform. */
export function manifestPath(platform, home) {
  if (platform === 'win32') {
    // Not a file path Chrome reads: the key's default value points at the JSON.
    return null;
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
  }
  return path.join(home, '.config', 'google-chrome', 'NativeMessagingHosts', `${HOST_NAME}.json`);
}

/** The registry command Windows needs, because a file is not enough there. */
export function windowsCommand(manifestFile) {
  return `reg add "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}" /ve /t REG_SZ /d "${manifestFile}" /f`;
}

export function buildManifest({ extensionId, hostPath }) {
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error(`an extension id is 32 characters in a-p, got "${extensionId}"`);
  }
  if (!path.isAbsolute(hostPath)) {
    throw new Error(`the host path must be absolute, got "${hostPath}"`);
  }
  return {
    name: HOST_NAME,
    description: 'AI Bridge Debate — the bridge, launched by Chrome over stdio',
    path: hostPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

/** Where the JSON has to live on Windows, since the registry points at it. */
export function windowsManifestFile(home) {
  return path.join(home, 'AppData', 'Local', 'ai-bridge', 'native-messaging', `${HOST_NAME}.json`);
}

function main(argv) {
  const args = argv.slice(2);
  const flag = (name, fallback) => {
    const at = args.indexOf(`--${name}`);
    return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
  };

  const platform = flag('platform', process.platform);
  const home = flag('home', os.homedir());
  const extensionId = flag('extension-id', '');
  const hostPath = flag('host', path.resolve('bridge', 'dist', 'native-host.js'));
  const write = args.includes('--write');

  if (!extensionId) {
    console.error('usage: node scripts/install-native-host.mjs --extension-id <32 chars in a-p> [--write]');
    console.error('');
    console.error('  the id appears at chrome://extensions once the unpacked extension is loaded');
    process.exit(2);
  }

  const manifest = buildManifest({ extensionId, hostPath });
  const target = platform === 'win32' ? windowsManifestFile(home) : manifestPath(platform, home);

  console.log(JSON.stringify(manifest, null, 2));
  console.log('');
  console.log(`# ${platform}: write this to`);
  console.log(`#   ${target}`);
  if (platform === 'win32') {
    console.log('# then register it:');
    console.log(`#   ${windowsCommand(target)}`);
    console.log('# and note: Chrome will not launch a .cmd — the host must be a real .exe');
  }

  if (write) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    console.log('');
    console.log(`wrote ${target}`);
    if (platform === 'win32') console.log('now run the reg command above — the file alone does nothing');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main(process.argv);
}
