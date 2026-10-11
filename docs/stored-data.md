# Stored data compatibility

Stable and dev retain their separate storage keys. Every saved-data consumer validates its own format before use. Valid data survives an app update; repairs are written back only when needed. Malformed JSON or an unsupported format is removed only for that key, never with a site-wide clear. If storage is blocked or full, the app continues with defaults/current in-memory state; persistence is unavailable.

- Active layouts accept version 2 and its unversioned predecessor. Legacy v1 layouts migrate to normalized v2 records, with the old record removed only after the replacement is saved. Numeric strings are converted, invalid geometry falls back, bounds are constrained, unknown widgets are dropped, and new widgets use defaults. Valid small cells retain their size.
- Named layouts retain the existing map format, validating and normalizing each layout independently.
- Saved devices retain the existing array format. Older strings and host-only records are normalized; missing protocol/port defaults are restored. Invalid or duplicate entries are removed. A stored address still must pass live discovery before automatic connection.
- Diagnostic history retains valid events and drops malformed entries.

Future incompatible changes must add an explicit migration from the preceding supported schema here; do not guess how an unknown version should translate. Extend the storage regression tests with real old-format examples. Offline app updates remain complete-release installations and do not clear settings or browser permissions. A module-import test ensures every static dependency is included in the offline release.
