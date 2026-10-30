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
const publisher = manifest.publisher ?? 'ai-bridge';
const engine = manifest.engines?.vscode ?? '^1.90.0';
const out = path.join(ROOT, `ai-bridge-${version}.vsix`);

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-'));

const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".map" ContentType="application/json" />
  <Default Extension=".svg" ContentType="image/svg+xml" />
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
if (fs.existsSync(path.join(EXT, 'media'))) {
  fs.cpSync(path.join(EXT, 'media'), path.join(extStage, 'media'), { recursive: true });
}
const readme = path.join(ROOT, 'README.md');
fs.writeFileSync(path.join(extStage, 'README.md'), fs.existsSync(readme) ? fs.readFileSync(readme) : '# AI Bridge\n');

if (fs.existsSync(out)) fs.rmSync(out);
execFileSync('zip', ['-qr', out, '.'], { cwd: stage, stdio: 'inherit' });
fs.rmSync(stage, { recursive: true, force: true });

const kb = (fs.statSync(out).size / 1024).toFixed(1);
console.log(`built ${path.basename(out)} (${kb} KB) — ${id}@${version}`);
