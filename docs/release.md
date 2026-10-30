# Release machinery

Generated: 2026-10-30T18:27:54.885Z

```
PASS  a release workflow exists
PASS  it runs on pushes to main
PASS  it can be run by hand, with a force option
PASS  it decides by comparing the version with an existing tag
PASS  packaging only happens when the version changed
PASS  it tags as vX.Y.Z
PASS  it attaches the .vsix to the release
PASS  every push publishes a rolling build, version or not
PASS  the versioned release is the one that is gated
PASS  the rolling build is a pre-release, so it never outranks a version
PASS  it tests before publishing
PASS  it needs write permission for contents
PASS  the landing page lives in docs/ and nowhere else
PASS  the page references its assets relatively
PASS  asset URLs are cache-busted so a stale CDN cannot serve the old page
PASS  a Pages workflow exists and deploys docs/
PASS  Pages checks its assets before deploying
PASS  CI still runs the whole suite
PASS  no browser test loads the page over file://
PASS  bump patch increments the last number
PASS  bump minor resets the patch
PASS  bump major resets minor and patch
PASS  an explicit version is accepted
PASS  both manifests move together
PASS  an unknown bump is refused
PASS  the two manifests agree in the repo right now
```

Result: 26/26 passed.

## How a release happens

1. `npm run version:bump patch` — both manifests move together.
2. Commit and push to `main`.
3. The workflow reads the version and checks for a `vX.Y.Z` tag.
4. No tag → build, bundle, run the contract suite and the full suite, pack the `.vsix`.
5. Publish a GitHub release at that commit with the `.vsix` attached, and make it latest.
6. Tag exists → the build still runs, nothing is published.
