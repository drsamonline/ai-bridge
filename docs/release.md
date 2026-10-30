# Release machinery

Generated: 2026-10-30T06:33:59.024Z

```
PASS  a release workflow exists
PASS  it runs on pushes to main
PASS  it can be run by hand, with a force option
PASS  it decides by comparing the version with an existing tag
PASS  packaging only happens when the version changed
PASS  it tags as vX.Y.Z
PASS  it attaches the .vsix to the release
PASS  it tests before publishing
PASS  it needs write permission for contents
PASS  a Pages workflow exists and deploys docs/
PASS  Pages checks its assets before deploying
PASS  CI still runs the whole suite
PASS  bump patch increments the last number
PASS  bump minor resets the patch
PASS  bump major resets minor and patch
PASS  an explicit version is accepted
PASS  both manifests move together
PASS  an unknown bump is refused
PASS  the two manifests agree in the repo right now
```

Result: 19/19 passed.

## How a release happens

1. `npm run version:bump patch` — both manifests move together.
2. Commit and push to `main`.
3. The workflow reads the version and checks for a `vX.Y.Z` tag.
4. No tag → build, bundle, run the contract suite and the full suite, pack the `.vsix`.
5. Publish a GitHub release at that commit with the `.vsix` attached, and make it latest.
6. Tag exists → the build still runs, nothing is published.
