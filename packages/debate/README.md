# The debate engine's release manifest

This is a **version and packaging manifest**, not a source package. The engine's
code still lives in `bridge/src/{runtime,repo,server}` because it shares the
bridge's CDP connection, adapters and observer — moving it before it stabilises
would mean copying those, not sharing them.

What the manifest is for:

- **an independent version.** `@ai-bridge/debate` releases on its own line,
  tagged `debate-v<version>`, and never touches the extension's `v<version>`.
- **a stable identity** for the artefact, so a tarball can say what it is.
- **the place the source will move to.** When the engine stops needing the
  bridge's internals, this becomes a real workspace member: the source moves
  under `packages/debate/src/`, and nothing about the release flow changes.

It is deliberately **not** in the root `workspaces` list. Adding it would make
`npm ci` resolve a package whose source is elsewhere, and the only thing that
needs it today is the release workflow.

Version it by editing `version` here. The release workflow reads it, refuses to
publish a tag that already exists, and packages `bridge/dist/{runtime,repo,server}`
with `docs/debate/`.
