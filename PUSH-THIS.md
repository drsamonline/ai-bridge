# Push this repo yourself

The zip contains the full project **and its git history** (three commits, branch `main`,
working tree clean). You only need to point it at a repo you can write to.

---

## If the repo already exists and is empty

```bash
unzip ai-bridge-repo.zip
cd ai-bridge

# only if your repo is not drsamonline/ai-bridge
git remote set-url origin https://github.com/<you>/ai-bridge.git

git push -u origin main
```

## If you need to create the repo first

On GitHub: **New repository** → name `ai-bridge` → **Public** →
**do not** add a README, a .gitignore or a licence (they would conflict with what is already committed).

Then run the two commands above.

With the GitHub CLI instead:

```bash
gh repo create ai-bridge --public --source=. --remote=origin --push
```

---

## After the push — two settings, once

1. **Actions** → the *CI* workflow should start on its own. If Actions are disabled for the repo,
   enable them under **Settings → Actions → General**.
2. **Settings → Pages → Source: GitHub Actions**. The *Landing page* workflow then publishes
   `docs/` on every change. Without this switch the Pages job fails at the deploy step.

That is all. The release workflow is already wired: it publishes **only when the version changes**.

---

## Cutting the first release

```bash
npm run version:bump patch    # 0.20.0 -> 0.20.1, both manifests together
git commit -am "release 0.20.1"
git push
```

The *Release* workflow reads the version, sees no `v0.20.1` tag, runs the full suite, packs the
`.vsix`, tags the commit and publishes it with the file attached.

To publish the current version without bumping it: **Actions → Release → Run workflow → force ✓**.

---

## Two things to change before you publish

**1. The publisher name.** `extension/package.json` still says `"publisher": "ai-bridge"`, a
placeholder. For the VS Code Marketplace it must match the publisher you register at
<https://marketplace.visualstudio.com/manage>. Changing it after release means existing installs
stop seeing updates, so set it before the first one.

**2. The repository field** is `https://github.com/drsamonline/ai-bridge`. If you push elsewhere,
update it in `extension/package.json` and in the links inside `README.md` and `docs/index.html`.

---

## What is in here

```
shared/      frozen contracts and wire types
bridge/      the CDP process: adapters, router, state, watchdog
extension/   the VS Code side: panel, diff, settings, commands, icon
test/        21 suites, 619 checks, plus fixtures and the token benchmark
docs/        evidence, benchmark, release notes, screenshots, landing page
scripts/     bump.mjs (version), make-vsix.mjs (dependency-free packer)
.github/     ci.yml, release.yml (version-gated), pages.yml
```

`npm install && npm run test:all` reproduces the 619 checks.
`npm run package` builds `ai-bridge-<version>.vsix` — a working 118 KB extension.
