# Marmaladeum — Version Backups and Rollback

## What Is Preserved

Every push to `main` retains its Git commit SHA and history. The
`Marmaladeum Permanent Version Backup` GitHub Actions workflow additionally
creates a commit-pinned GitHub pre-release tagged
`marmalade-backup-<first 12 SHA characters>`. It attaches:

- `Marmaladeum-Web-<sha>.tar.gz`: ready-to-deploy web runtime including the
  pinned, locally installed MKV decoder and generated icon assets.
- `Marmaladeum-Git-History-<sha>.bundle`: a full Git bundle containing all
  reachable Git revisions, including the earlier versions of Marmaladeum.
- `SHA256SUMS-<sha>.txt`: checksums for both archives.
- Any successful platform builds for the same commit: Windows EXE, macOS DMG,
  Linux AppImage, iOS simulator ZIP, and Android debug APK.

The platform build workflows ALSO keep ordinary GitHub Actions artifacts for
convenience. **Those temporary artifacts expire after 30 days**; the corresponding
release attachments are the long-term backup. Android has additionally created
its own `android-preview-<sha>` releases for past successful previews.

A failed platform build cannot have a genuine binary archived. The source and
Git history remain recoverable, but an unsuccessful or never-run old native
build is not automatically available as a download. The historical native
artifacts that expired *before* the permanent backup workflows were introduced
cannot be retroactively guaranteed.

Do not delete GitHub releases, tags, or repository history and do not force-push
`main` if you want to retain every rollback point. The Git bundle provides a
second, recoverable source archive inside GitHub Releases but **not** an off-site
backup; for disaster recovery from loss of GitHub itself, export these assets
to a separately controlled storage provider as well.

## Roll Back the Live Website

1. Open **GitHub → Actions → Deploy to marmaladeum.com → Run workflow**.
2. In `rollback_ref`, enter either a full 40-character historical commit SHA
   or an existing `marmalade-backup-<12 characters>` tag.
3. Run the workflow and check its DreamHost deployment result. This deliberately
   deploys that saved version of the web application without force-pushing or
   deleting the newer Git commits.

Leaving `rollback_ref` empty redeploys the current `main` head. Previously
installed client-side service workers may require a reload to refresh the page.
If an unusually old revision does not support the current build steps, use its
GitHub Release web archive as the verified manual deployment input.

## Restore Source History

Fetch the historic commit directly in Git or download a version backup's
`.bundle` asset and verify it:

```bash
git bundle verify Marmaladeum-Git-History-<sha>.bundle
git clone Marmaladeum-Git-History-<sha>.bundle Marmaladeum-Recovery
```

Create a recovery branch at the chosen old SHA, test it, and restore via a
normal GitHub pull request. Do **not** erase current commits simply to roll
back behavior.

## Release Integrity

- Every backup is tied to the complete Git commit SHA.
- Backup assets are hashed to detect accidental corruption.
- The newest available downloadable native binary is not necessarily from the
  newest commit; check build status and compare commit IDs.
- Simulator ZIPs and Android debug APKs are not App Store / Play Store
  production-signed distributions.
- Source commits can be restored even when a platform-specific build failed.

## Web deployment identity and verification

The Pages, DreamHost, and permanent web backup workflows use the same release
stamping utility. The staged HTML references local assets by their content hash;
the service worker cache is isolated by full Git SHA. The Settings footer reads
`build-info.json`. This manifest contains the commit and SHA-256 hashes of the
HTML, service worker, and referenced local runtime assets. Deployment checks
compare the live manifest and asset bytes with the staged files, bypassing
ordinary browser cache. A successful upload alone is not sufficient.

For rollback, DreamHost stamps the selected historical commit, not the workflow
trigger SHA. Old commits without compatible build steps still require manual
archive recovery. External CDN dependencies and lazy-loaded decoder binaries are
not covered by this shell manifest; native packaging is verified separately.

## Restore verification and reproducibility checks

The permanent backup job extracts the newly generated web archive into a fresh
temporary directory and verifies the archived checksums, commit identity,
content-versioned HTML references and service-worker cache identity before
publishing. The contract suite also tests deterministic stamping, tamper
detection, and simulated forward/backward service-worker cache migrations.
These are non-destructive rehearsals; they do not roll back the production site
or prove bit-for-bit reproducibility of every native installer.
