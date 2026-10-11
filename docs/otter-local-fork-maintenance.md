# Otter local fork maintenance

This repository is a private local fork of DeepWrite 1.6.0 for the Otter novel
workbench integration. The upstream checkout is recorded as the `upstream`
remote at `https://github.com/swjybky/deepwrite.git`. Do not fetch, merge, or
rebase upstream automatically. Review each upstream release against the local
patches and the novel workspace's V1 protocol before updating the fork.

## Local build identity and update policy

The desktop installer uses the distinct application ID `studio.otter.novel-workbench`
and product name `Otter Novel Workbench`, so it installs and stores its profile
separately from a stock DeepWrite installation. Local artifacts carry the
`-local` suffix. The electron-builder publish target is intentionally unset.

The Main-process `UpdateService` is fail-closed: checking reports that updates
are unsupported, while download and install requests are rejected. It does not
fetch the upstream manifest or pass a feed URL to `electron-updater`. The
top-level `update.json` is marked disabled as an additional guard. A future
update service must use an explicitly owned feed and a reviewed trust policy;
never restore the upstream feed implicitly.

## Upstream and licensing notes

The inherited `LICENSE` identifies DeepWrite as Apache License 2.0. Preserve
that license and upstream notices in redistributed source or binaries, and mark
local changes clearly. The source snapshot did not include a `NOTICE` file.
DeepWrite also depends on separately licensed packages, including the Pi
runtime packages; verify their current package licenses and redistribution
terms before publishing a combined installer. This note records the source
snapshot's license files; it is not a substitute for a distribution review.

Keep upstream changes in small, reviewable commits. Before updating, create a
new baseline tag, compare the upstream diff, rerun the architecture/security
review, and verify that local-only update behavior, application identity,
project-file authority, credentials isolation, and Windows packaging still
hold. Never reset the shared novel workspace or copy generated project data
into this source repository.

## Local verification

Use Node 24 and pnpm 11 with the committed lockfile:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm --dir apps/desktop exec electron-builder --config electron-builder.yml --config.electronVersion=42.5.0 --config.electronDist=../../node_modules/electron/dist --win nsis --x64 --publish never
node apps/desktop/scripts/electron-otter-smoke.mjs --executable "apps/desktop/release/win-unpacked/Otter Novel Workbench.exe"
```

Electron's installation guide documents the `ELECTRON_MIRROR` and
`ELECTRON_CUSTOM_DIR` overrides. On this machine the pinned 42.5.0 runtime was
installed from `https://npmmirror.com/mirrors/electron/` using
`ELECTRON_CUSTOM_DIR=v42.5.0`; the installed archive SHA-256 matched the
`electron-v42.5.0-win32-x64.zip` entry in the lockfile-installed package's
`checksums.json`. Keep that verification enabled and use the same locked npm
package metadata when preparing another machine. Do not persist mirror
environment variables globally.

Reference: [Electron installation guide](https://github.com/electron/electron/blob/main/docs/tutorial/installation.md).

The Windows test installer is unsigned because this private local build has no
code-signing certificate. Windows may show a SmartScreen warning. Do not enable
publishing as part of a local build.
