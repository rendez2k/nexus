# The Nexus rename

The product is now **Nexus**. The rename was deliberately split: everything a
user *reads* has changed, and nothing a running install *depends on* has.

## What changed

- All prose: `README.md`, `docs/`, `AGENTS.md`, `CLAUDE.md`, `SECURITY.md`,
  issue templates, code comments.
- The log prefix, `[codex-router] ...` to `[nexus] ...`, in `router.log` and in
  the tests that assert on it.
- `FRONTEND.label` in `src/start.mjs`, which names the process in startup and
  health-check failure messages ("Nexus exited before becoming healthy").
- The JSON `Content-Type` rejection message in `src/router.mjs`.
- `TARGET_DISPLAY_NAME` in `src/paths.mjs`. Note its actual reach: it is read
  in exactly one place, `src/service-linux.mjs`, as the systemd unit
  `Description`. On Windows and macOS it renders nowhere.
- `package.json` `name`, `codex-model-router` to `nexus`.
- A new icon set under `assets/icon/`, with shared brand tokens in
  `assets/brand/tokens.css`.

## What this does *not* change on screen

The model picker entries come from each config's `displayName` field, not from
any of the above, so the rename does not alter a single row in it. Neither the
Windows service, the tray, nor the Codex UI displays the product name today.
On Windows the rename is visible only in `router.log`, in startup/health error
text, and in the documentation.

## What did not change, and why

Every identifier below is either written into a user's `~/.codex`, sent on the
wire, or already registered with the OS. Changing any of them renames the
product *and* orphans every existing install in the same commit.

| Identifier | Where it lives | Breaks if renamed alone |
| --- | --- | --- |
| `model_provider = "codex-router"` | the user's `config.toml` | Codex stops resolving routed models |
| `/_codex-router/<key>/v1` | the wire path clients are configured with | every configured client 404s |
| `# BEGIN codex-router-managed` | sentinels in `config.toml` | managed blocks orphan; the next write duplicates them |
| `.codex-router-managed` | per-skill ownership marker | installed skills look unmanaged |
| `~/.codex/codex-router/` | `STATE_DIR` | secrets, catalogs and usage history disappear |
| `io.github.codex-router` | launchd/systemd service label | the running service is no longer found or stoppable |
| `CODEX_ROUTER_*`, `MODEL_ROUTER_*` | env vars | user overrides silently stop applying |
| `bin/model-router`, `codex-router.ps1` | entry points in docs and muscle memory | installed shortcuts and scheduled tasks break |
| `skills/codex-router/` | skill pack dir, keyed in `managed-skills.json` | the skill reinstalls as a second copy |
| `duolahypercho/codex-router` | `src/update.mjs` self-update remote | `bin/update` pulls from the wrong repository |

## Finishing the job

There is a precedent in this codebase: it was once `kimi-router`, and that
rename is still visible in `LEGACY_STATE_DIR`, `LEGACY_SERVICE_LABEL`,
`PROTOTYPE_SERVICE_LABEL`, `LEGACY_STATE_DIRS` and the `KIMI_*` env
fallbacks. `codex-router` to `nexus` should follow the same shape:

1. Introduce the new identifier and demote the current one to the legacy list.
2. Extend `bin/migrate` to move state, rewrite `config.toml` sentinels and the
   provider ID, and re-register the service under the new label.
3. Keep `CODEX_ROUTER_*` reading as a fallback behind `NEXUS_*`.
4. Extend `test/legacy-migration.test.mjs` to cover the new hop.

Do it as one change with the migration, not as a rename now and a migration
later — the gap between the two is where installs break.
