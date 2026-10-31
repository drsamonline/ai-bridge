/**
 * Batch 8.3 — per-feature model routing.
 *
 * `routing.ts` and `service.ts` are host-free and tested; `commit.ts` keeps the
 * git call a plain function of a directory so the harness can drive it against a
 * real repository. The editor glue is in `extension.ts`.
 */

export * from './routing';
export * from './service';
export * from './commit';
export * from './curl';
