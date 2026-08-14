# Releasing Exstream

Releases are deliberately explicit. A published GitHub Release is the public
release note and triggers npm publication; an ordinary push or tag does not
publish a package.

## One-time npm setup

Configure `exstream.js` on npm with a GitHub Actions trusted publisher:

- organization or user: `micheletriaca`;
- repository: `exstream`;
- workflow filename: `release.yml`;
- environment: leave empty unless the workflow is later assigned one;
- allowed action: `npm publish`.

The workflow uses GitHub's OpenID Connect identity and does not require a
long-lived `NPM_TOKEN` secret.

## Prepare a release

1. Start a `release/<minor>` branch, such as `release/0.33`, from an up-to-date
   `master` with a green CI run.
2. Choose the version according to the policy in `SUPPORT.md`.
3. Set the same version in `package.json` and `package-lock.json`:

   ```bash
   npm version 0.33.0 --no-git-tag-version
   ```

4. Finalize the matching version and date in `CHANGELOG.md`.
5. Check that every incompatible change has an explicit migration path.
6. Run the local release checks:

   ```bash
   npm ci
   npm run format:check
   npm run lint
   npm audit
   npm test
   npm run test:browser
   npm pack --dry-run
   ```

7. Commit the version, changelog and release changes together, push the release
   branch and open a pull request into `master`.
8. Wait for every required CI check to pass, then merge the pull request.
9. Update local `master`, create an annotated tag on the merge commit and push
   it:

   ```bash
   git switch master
   git pull --ff-only origin master
   git tag -a v0.33.0 -m "v0.33.0"
   git push origin v0.33.0
   ```

## Publish

Create a draft GitHub Release from the tag. Copy the matching `CHANGELOG.md`
section into the description and edit it for readability instead of using a raw
commit list. Publish the release only after confirming that the tag identifies
the merge commit and that commit's CI run is green.

Publishing the GitHub Release starts `.github/workflows/release.yml`. The
workflow:

1. checks that the tag and package version match;
2. installs exactly from the lockfile and reruns the complete release gate;
3. inspects the npm package contents;
4. publishes the public package. npm records provenance from the trusted GitHub
   identity.

If publication fails, fix the cause and rerun the failed GitHub Actions job. Do
not create a second tag for the same version.

Prerelease GitHub Releases do not publish to npm. If prerelease publication is
needed later, define its npm dist-tag and workflow semantics before enabling it.

## Verify

After the workflow completes:

```bash
npm view exstream.js version
npm view exstream.js@0.33.0 dist.integrity
```

Check that the GitHub Release, npm version and Git tag all identify the same
commit. Add a fresh `Unreleased` section to `CHANGELOG.md` in the next change.