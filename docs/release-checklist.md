# Release checklist

## Before tagging

- [ ] `npm test`
- [ ] `node tools/check-payload.mjs`
- [ ] `node tools/verify-install.mjs`
- [ ] `node tools/build-python-wrapper.mjs --check`
- [ ] `node tools/build-commercial.mjs --out /tmp/ars-commercial-test --force --strict` (when commercial tooling changed)
- [ ] `git diff --check`
- [ ] version matches in `package.json`, `CITATION.cff`, and `CHANGELOG.md`

## Publish

1. Commit and push; wait for CI green.
2. Publish npm: `npm publish --registry=https://registry.npmjs.org`.
3. Tag and create the GitHub Release; the release event runs
   `.github/workflows/publish-github-package.yml`.
4. `GITHUB_TOKEN=... npm run check:release-parity`.
5. Confirm the repository Packages page manually. GitHub's API explicitly does
   not expose npm package-to-repository linkage; a 404 from
   `/repos/{owner}/{repo}/packages` is not proof that the link is absent.

The GitHub Packages publish script now checks whether the exact version already
exists and skips it, avoiding a red duplicate-publish run.
