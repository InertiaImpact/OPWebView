# Stable and development deployments

`main` publishes https://inertiaimpact.github.io/OPWebView/ and `dev` publishes https://inertiaimpact.github.io/OPWebView/dev/ (no trailing period).

Both push events run the same Pages workflow. It checks out and tests both branches, then deploys one artifact containing stable files at its root and development files in `dev/`. Never deploy either branch alone: a Pages deployment replaces the entire site.

Develop on `dev`, push to test on the development URL, then promote selected changes through a pull request into `main`. Keep the development-only HTML channel marker, watermark and manifest name out of the promotion; retain the shared deployment and isolation infrastructure on both branches.

Development has a centered, non-interactive DEV watermark, separate saved devices/layouts/logs, its own offline caches and a separate relative PWA identity/scope. Stable settings remain unchanged. Both sites share an origin, so browser site permissions are shared; clearing site data affects both. No automatic site-data clearing is performed.

The stable worker excludes `/dev/` so it cannot accidentally serve the stable HTML shell for development navigation. Reopen stable online once to receive this updated worker before testing dev on a browser with an older stable installation. Each installed version remains available offline after its initial successful cache installation.

Both `/dev` and `/dev/` bypass the stable worker; GitHub redirects the former to the canonical trailing-slash URL. Use `/dev/` in bookmarks. The workflow uses Node 24 and pins Ubuntu 24.04 to keep runner image migrations from changing deployment unexpectedly.
