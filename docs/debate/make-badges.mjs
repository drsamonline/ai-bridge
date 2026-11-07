#!/usr/bin/env node
/**
 * Locally generated badges for the debate engine.
 *
 * The estate generates badges locally rather than pointing at shields.io, so a
 * badge cannot silently change colour or wording because a third party changed
 * its default. Same geometry as the ai-bridge badges (label #12181f, 11px
 * Verdana 600, rx 4, gradient overlay) with this project's own accent as the
 * value colour, because the engine has its own palette.
 *
 * Regenerate after a version bump or a change in the check count:
 *   node docs/debate/make-badges.mjs
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'badges');

/** Label on the left, value on the right, and the value's fill. */
const BADGES = [
  ['spec', 'v6', '#8a5210'],
  ['status', 'pre-alpha', '#8a5210'],
  ['build', 'step 1 of 7', '#3f5c78'],
  ['checks', '651 inherited', '#3f5c78'],
  ['engine', 'ai-bridge', '#3f5c78'],
  ['node', '20 or newer', '#2f6b46'],
  ['licence', 'PolyForm NC', '#2f6b46'],
];

/**
 * Verdana 11px semibold averages ~6.7px per character. Calibrated against the
 * existing ai-bridge badges: "version" -> 60, "0.34.0" -> 53, "tests" -> 47.
 */
const width = (text) => Math.max(40, Math.round(text.length * 6.7) + 13);

function svg(label, value, colour) {
  const lw = width(label);
  const vw = width(value);
  const total = lw + vw;
  const aria = `${label}: ${value}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="24" role="img" aria-label="${aria}">
  <title>${aria}</title>
  <defs>
    <linearGradient id="s" x2="0" y2="100%">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".12"/>
      <stop offset="1" stop-color="#000000" stop-opacity=".12"/>
    </linearGradient>
  </defs>
  <g>
    <rect width="${lw}" height="24" rx="4" fill="#12181f"/>
    <rect x="${lw}" width="${vw}" height="24" rx="4" fill="${colour}"/>
    <rect width="${total}" height="24" rx="4" fill="url(#s)"/>
    <rect x="${lw}" width="2" height="24" fill="#0b0e13" fill-opacity=".35"/>
  </g>
  <g fill="#e6edf3" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" font-weight="600">
    <text x="${lw / 2}" y="16.5" text-anchor="middle">${label}</text>
    <text x="${lw + vw / 2}" y="16.5" text-anchor="middle">${value}</text>
  </g>
</svg>
`;
}

fs.mkdirSync(OUT, { recursive: true });
for (const [label, value, colour] of BADGES) {
  const file = path.join(OUT, `${label}.svg`);
  fs.writeFileSync(file, svg(label, value, colour));
  console.log(`${path.relative(process.cwd(), file)}  ${label}: ${value}`);
}
