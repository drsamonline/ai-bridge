#!/usr/bin/env node
/**
 * Dependency-free .vsix packer.
 *
 * A .vsix is an OPC zip: [Content_Types].xml + extension.vsixmanifest + the
 * extension folder. `vsce` is the canonical tool and the release workflow uses it,
 * but it needs network access at pack time, which fails in locked-down CI and
 * sandboxes. This produces the same artifact with nothing but `zip`.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const EXT = path.join(ROOT, 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'package.json'), 'utf8'));

const id = manifest.name;
const version = manifest.version;
const publisher = manifest.publisher ?? 'drsamonline';
const engine = manifest.engines?.vscode ?? '^1.90.0';
const out = path.join(ROOT, `ai-bridge-${version}.vsix`);

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-'));

const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".map" ContentType="application/json" />
  <Default Extension=".svg" ContentType="image/svg+xml" />
  <!-- The icon is a .png. An OPC package without a content type for it is not a
       valid package, and a strict validator refuses the upload. -->
  <Default Extension=".png" ContentType="image/png" />
  <Default Extension=".md" ContentType="text/markdown" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
</Types>`;

const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${id}" Version="${version}" Publisher="${publisher}" />
    <DisplayName>${manifest.displayName ?? id}</DisplayName>
    <Description xml:space="preserve">${(manifest.description ?? '').replace(/[<&]/g, ' ')}</Description>
    <Tags>ai,chat,copilot,automation</Tags>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${engine}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
  </Assets>
</PackageManifest>`;

fs.writeFileSync(path.join(stage, '[Content_Types].xml'), contentTypes);
fs.writeFileSync(path.join(stage, 'extension.vsixmanifest'), vsixManifest);

const extStage = path.join(stage, 'extension');
fs.mkdirSync(extStage, { recursive: true });

// Only what the extension needs at runtime: the bundle, the manifest, the icon.
fs.copyFileSync(path.join(EXT, 'package.json'), path.join(extStage, 'package.json'));
const bundle = path.join(EXT, 'dist', 'extension.js');
if (!fs.existsSync(bundle)) {
  console.error('extension/dist/extension.js is missing — run `npm run build:bundle` first');
  process.exit(1);
}
fs.mkdirSync(path.join(extStage, 'dist'), { recursive: true });
fs.copyFileSync(bundle, path.join(extStage, 'dist', 'extension.js'));
// The bridge is a separate process the extension spawns. It was missing from every
// package built before this: the extension installed, activated, and then failed
// with "bridge entry not found" — because the file was never shipped.
const bridgeBundle = path.join(ROOT, 'bridge', 'dist', 'bridge.js');
if (!fs.existsSync(bridgeBundle)) {
  console.error('bridge/dist/bridge.js is missing — run `npm run build:bundle` first');
  process.exit(1);
}
fs.mkdirSync(path.join(extStage, 'bridge', 'dist'), { recursive: true });
fs.copyFileSync(bridgeBundle, path.join(extStage, 'bridge', 'dist', 'bridge.js'));

// playwright-core stays outside the bridge bundle (it resolves driver files from
// disk at runtime), so it travels as a real dependency, ~8 MB.
const playwright = path.join(ROOT, 'node_modules', 'playwright-core');
if (!fs.existsSync(playwright)) {
  console.error('node_modules/playwright-core is missing — run `npm ci` first');
  process.exit(1);
}
fs.cpSync(playwright, path.join(extStage, 'node_modules', 'playwright-core'), { recursive: true });

if (fs.existsSync(path.join(EXT, 'media'))) {
  fs.cpSync(path.join(EXT, 'media'), path.join(extStage, 'media'), { recursive: true });
}
const licence = path.join(ROOT, 'LICENSE');
fs.writeFileSync(
  path.join(extStage, 'LICENSE.txt'),
  fs.existsSync(licence) ? fs.readFileSync(licence) : 'All rights reserved.\n',
);

const readme = path.join(ROOT, 'README.md');
fs.writeFileSync(path.join(extStage, 'README.md'), fs.existsSync(readme) ? fs.readFileSync(readme) : '# AI Bridge\n');

if (fs.existsSync(out)) fs.rmSync(out);
// `-X` drops the extra file attributes Info-ZIP writes by default (Extended
// Timestamp 0x5455 and Unix UID/GID 0x7875). Open VSX refuses a package whose
// entries carry them — "potentially harmful extra fields" — which is how the first
// real publish died after the namespace was created.
execFileSync('zip', ['-qrX', out, '.'], { cwd: stage, stdio: 'inherit' });

// Verify it rather than trust the flag: a wrong zip invocation is invisible until
// the registry rejects the upload, and by then it is a red CI run to debug.
{
  const { execFileSync: readZip } = await import('node:child_process');
  const listing = readZip('unzip', ['-Z1', out], { encoding: 'utf8' });
  const verbose = readZip('unzip', ['-Z', out], { encoding: 'utf8' });
  if (/extra field/i.test(verbose)) {
    console.error('the package contains zip entries with extra fields — Open VSX will reject it');
    process.exit(1);
  }
  if (listing.trim().split('\n').length < 3) {
    console.error('the package looks empty');
    process.exit(1);
  }
}
fs.rmSync(stage, { recursive: true, force: true });

const kb = (fs.statSync(out).size / 1024).toFixed(1);
console.log(`built ${path.basename(out)} (${kb} KB) — ${id}@${version}`);
