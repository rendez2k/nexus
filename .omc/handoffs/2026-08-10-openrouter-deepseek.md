# Handoff — OpenRouter DeepSeek models + picker delineation

**Date:** 2026-08-10
**Repo:** `C:\Users\rende\Documents\codex-router-patch` (branch `main`, ahead 3 of origin)
**Status:** Work complete and live-verified. **Nothing committed.**

---

## 1. The original problem

Screenshot of the Codex model picker showed only two DeepSeek entries
(`DeepSeek V4 Flash (API)`, `DeepSeek V4 Pro (API)`) despite having DeepSeek
credentialed both directly *and* through OpenRouter.

**Root cause:** `config/openrouter/` shipped only `openrouter.json` (the provider
definition) and **zero model files**. OpenRouter was a credentialed, enabled
provider that routed nothing. `merged-models.json` had 14 entries, 0 with
`provider: openrouter`.

This was not a bug. OpenRouter sat in the deliberate **catalog-only reseller**
category (`AGENTS.md` line 205). Eleven other providers are still in that state
by design: `cerebras`, `fireworks`, `gemini-api`, `github-copilot`, `groq`,
`huggingface`, `local`, `mistral`, `nvidia-nim`, `opencode-zen`, `siliconflow`,
`together`. The prescribed path for those is `bin/curate-models`, which writes
`user-models.json` (absent on this machine — never run).

---

## 2. What changed in the checkout

**New files (untracked):**

- `config/openrouter/deepseek-v4-pro.json` — priority 64
- `config/openrouter/deepseek-v4-flash.json` — priority 63

Field provenance (all confirmed, none inferred, per `AGENTS.md` "Ship a model to
every installer" step 1):

| Field | Value | Source |
|---|---|---|
| upstream ids | `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash` | `bin/discover-models openrouter` |
| `contextWindow` | `1048576` | OpenRouter live `/api/v1/models` |
| `inputModalities` | `["text"]` | OpenRouter live `/api/v1/models` |
| effort ladders | mirror the direct-API configs | OpenRouter reasoning docs: accepts `minimal`→`max`, maps unsupported to nearest |
| `requestProfile` | `auto-tool-choice` | see below |
| priorities | 63/64 | free block between clinepass (62) and commandcode (100) |

**Why `auto-tool-choice` and not `deepseek-thinking`:** the native profile injects
`payload.thinking = {type:"enabled"}`, which is DeepSeek's own parameter and is
absent from OpenRouter's OpenAI-shaped surface. `auto-tool-choice`
(`src/api-forwarder.mjs:472`) exists for exactly this case — its comment names
OpenRouter — and normalizes only the forced `tool_choice` that the *upstream*
DeepSeek model rejects while thinking. Live tool-calling tests pass, confirming
the choice.

Priorities 63/64 keep the direct DeepSeek entries (6/7) ahead, so the picker's
priority-ordered native spawn-override subset at 1–9 is not displaced
(`AGENTS.md` step 5).

**Modified:** `test/registry.test.mjs`

- Added the two slugs to the exhaustive `LISTED_MODELS` inventory assertion
  (it fails by design when the registry changes — that tripwire worked).
- New test: `"OpenRouter DeepSeek models route as a reseller of the upstream model"`
  pins upstream ids, the request profile, modalities, context/compaction, absent
  `multiAgentVersion`, and that a reseller never outranks the direct entry.

**Gates:** `npm run check` passes. `npm test` = **836 tests, 0 failures**, 13
skipped. All 13 skips are pre-existing platform gates on Windows (macOS keychain,
systemd, POSIX shell, symlink privileges) — unrelated.

---

## 3. What was deployed to the live install (NOT the same as the checkout)

⚠️ **The running router is a different tree.** `install-manifest.json` gives
`sourceRoot = C:\Users\rende\AppData\Local\codex-router`. Editing `config/` in
this checkout changes nothing the gateway reads.

`bin/update` is **not** the deploy mechanism — `SOURCE_ROOT` resolves from the
script's own location (`src/paths.mjs:26`), so running it here would git-pull
*this* checkout from GitHub, and would be refused anyway by `localModifications()`
given ~20 tracked edits. `install.ps1` from here *would* deploy, but it would
re-home the install onto all the in-progress Claude Code work — deliberately not
done.

**Deployed by targeted file copy into `AppData\Local\codex-router\config\`:**

1. The 2 new `config/openrouter/*.json` files.
2. **9 display-name files you had already edited but never deployed.** The config
   diff between the two trees was verified to be *exclusively* these 9
   `displayName` lines — nothing else:
   `anthropic/api/claude-opus-4.8`, `deepseek/deepseek-v4-{pro,flash}`,
   `grok/{api,oauth}/grok-4.5`, `kimi/api/kimi-k3`, `kimi/oauth/{k3,
   kimi-for-coding,kimi-for-coding-highspeed}`.
   `(API)` → `(DeepSeek API)`, `(OAuth)` → `(Kimi Code OAuth)`, etc. — this is
   the "no clear delineation on what belongs to what" fix.

Then, from the AppData tree: `node src/catalog.mjs` (14 → **16** models) and
`node src/litellm-config.mjs` (83 routes).

**The live install and this checkout now have identical `config/` trees but
differ everywhere else.** AppData is at commit `f43c004` with its own separate
local edits to `AGENTS.md`, `caller-auth.mjs`, `control.mjs`, `router.mjs`,
`docs/DESKTOP-TRAY.md`.

---

## 4. Verification evidence

`bin/test-model` (= `src/compatibility-test.mjs`) run live from the AppData tree:

```
openrouter/deepseek-v4-pro    PASS basic / streaming / tool calling / compaction
openrouter/deepseek-v4-flash  PASS basic / streaming / tool calling / compaction
deepseek/deepseek-v4-pro      PASS basic / streaming / tool calling / compaction  (control)
```

`usage-events.jsonl` confirms correct billing attribution — `provider: openrouter`
on the new routes, `provider: deepseek` on the direct ones.

---

## 5. Two real bugs found — worth fixing, not yet filed

### (a) `service.mjs restart` / `stop` do not recycle the process

`node src/service.mjs restart` returned `{"state":"running"}` while PID 41788 —
started 15:05, ~2 hours stale — kept holding port 4102. `stop` returned
`{"state":"stopped"}` with the same process still listening. Required a manual
`Stop-Process -Id <pid> -Force` then `service.mjs start` to get a fresh PID.

### (b) A stale registry surfaces as HTTP 401, which is badly misleading

The orphaned router didn't know the new gateway ids, so
`openrouter-deepseek-v4-pro` fell through to the **native OpenAI path** and was
sent to OpenAI with an OpenAI credential → `HTTP 401`. It looks exactly like a
bad OpenRouter key. Ruled that out first: the key returns HTTP 200 from
`/api/v1/key` (paid tier, no expiry) and a direct chat completion works.

**The tell:** `usage-events.jsonl` showed `"provider":"openai"` on a model that
is not OpenAI's. An unknown gateway id should fail as a config/routing error, not
silently borrow the native provider's credential.

**Cost:** roughly an hour of misdirected debugging. Fixing (b) is the higher
-value change.

---

## 6. Open items

1. **Commit nothing-is-committed.** Branch is ahead 3 of origin with ~25 modified
   + 9 untracked paths spanning several unrelated workstreams (OpenRouter
   configs, display names, Claude Code integration, desktop tray). Needs
   splitting into coherent commits — do not commit as one blob.
2. **`AGENTS.md` line 190 tension.** It says plainly: *"Never edit the checked-in
   `config/` registry tree merely to satisfy one machine's request"*, and prefers
   curation here. You chose the registry route knowingly after this was flagged,
   but it will come up in review. The alternative, still available:
   `node .\src\curate-models.mjs openrouter --models deepseek/deepseek-v4-pro,deepseek/deepseek-v4-flash --request-profile auto-tool-choice --apply`
3. **Native OpenAI picker entries carry no qualifier** (`5.6 Sol`, `5.5`,
   `5.4 Mini`…), so "unlabelled = OpenAI" is an implicit convention. Those are
   Codex's own native models, not registry entries — labelling them is a separate
   change.
4. **Codex restart still needed** to see the new picker — fully quit and reopen.
5. Consider whether the other 11 catalog-only providers should stay that way.

---

## 7. Commands worth keeping

```bash
# Deploy config-only changes to the live install (from the checkout)
cp config/openrouter/*.json "$HOME/AppData/Local/codex-router/config/openrouter/"
cd "$HOME/AppData/Local/codex-router" && node src/catalog.mjs && node src/litellm-config.mjs

# Verify the restart ACTUALLY happened — do not trust the service output
powershell -NoProfile -Command "\$p=(Get-NetTCPConnection -LocalPort 4102 -State Listen).OwningProcess; Get-Process -Id \$p | Select Id,StartTime"
# if StartTime predates your edit: Stop-Process -Id <pid> -Force; then service.mjs start

# Live route test (uses provider quota)
cd "$HOME/AppData/Local/codex-router" && node src/compatibility-test.mjs 'openrouter/deepseek-v4-pro' --live --yes

# What the picker actually reads
node -e "const m=require('C:/Users/rende/.codex/codex-router/merged-models.json'); console.log((m.models||m).length)"
```

**Read-only diagnostics:** `bin/discover-models <provider>`,
`./bin/model-router codex providers list --json`, `tail usage-events.jsonl`
(check the `provider` field first when a route 401s).
