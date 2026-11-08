/**
 * The native messaging host — the bridge, launched by Chrome.
 *
 * This is the third transport and the only one where the *launch* is the
 * authorisation: Chrome starts this process on behalf of one extension and passes
 * that extension's origin as argv[2]. No port, no socket, no token.
 *
 * The rule that governs every line here: **stdout is the protocol.** A stray
 * `console.log` corrupts the stream, so logging goes to stderr and nowhere else.
 */

import { BridgeRuntime } from './runtime/index';
import { decodeFrames, encodeFrame, originFromArgv } from './server/nativeMessaging';

/** stdout is the wire; everything a human reads goes to stderr. */
const stderrLog = {
  info: (msg: string, meta?: unknown) => write('info', msg, meta),
  warn: (msg: string, meta?: unknown) => write('warn', msg, meta),
  error: (msg: string, meta?: unknown) => write('error', msg, meta),
  debug: (msg: string, meta?: unknown) => write('debug', msg, meta),
  child: () => stderrLog,
};

function write(level: string, msg: string, meta?: unknown): void {
  const line = meta === undefined ? msg : `${msg} ${JSON.stringify(meta)}`;
  process.stderr.write(`[native-host] ${level} ${line}\n`);
}

function reply(payload: Record<string, unknown>): void {
  try {
    process.stdout.write(encodeFrame(payload));
  } catch (err) {
    // A message too large for the frame limit is worth telling the caller about
    // rather than dropping: the panel would otherwise wait for its timeout.
    process.stdout.write(
      encodeFrame({ id: payload.id, error: `EREPLY: ${(err as Error).message}` }),
    );
  }
}

async function main(): Promise<void> {
  const origin = originFromArgv(process.argv);
  if (!origin) {
    // Without a valid origin this process was not launched by an extension, and
    // nothing it is told can be trusted.
    stderrLog.error('refusing to run: argv[2] is not a chrome-extension origin', { argv: process.argv.slice(2) });
    process.exit(1);
  }
  stderrLog.info('started for', { origin });

  const runtime = new BridgeRuntime({
    log: stderrLog as never,
    sessionsRoot: process.env.AI_BRIDGE_HOME
      ? `${process.env.AI_BRIDGE_HOME}/.ai-bridge`
      : undefined,
  });

  let rest: Buffer = Buffer.alloc(0);

  process.stdin.on('data', (chunk: Buffer) => {
    let decoded;
    try {
      decoded = decodeFrames(chunk, rest);
    } catch (err) {
      stderrLog.error('framing error; closing the stream', { error: (err as Error).message });
      process.exit(1);
      return;
    }
    rest = Buffer.from(decoded.rest);

    for (const message of decoded.messages) {
      const msg = message as { op?: string; id?: number };
      // Handled in order, so a create followed by a run cannot overtake itself.
      void (async () => {
        try {
          const result = await runtime.control(msg as never);
          reply({ id: msg.id, result });
        } catch (err) {
          reply({ id: msg.id, error: (err as Error).message });
        }
      })();
    }
  });

  process.stdin.on('end', () => {
    // Chrome closed the port: the extension is gone or was disabled.
    stderrLog.info('stdin closed; exiting');
    void runtime.stop().finally(() => process.exit(0));
  });
}

main().catch((err) => {
  stderrLog.error('fatal', { error: (err as Error).message });
  process.exit(1);
});
