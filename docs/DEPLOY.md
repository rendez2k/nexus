# Deploying Nexus to a Windows machine

This tree is upstream `codex-router` at `9b2b88a` plus this fork's layer. It is
roughly 84 modules and one minor version ahead of a checkout installed before
that sync, so **it cannot be deployed by copying files over an older install**.
Half-copying is what produced most of the confusion this fork has already been
through: a tree where `src/` and `config/` disagree fails in ways that look like
credential, catalog or service problems and are none of them.

Install it as an install. The steps below take about ten minutes.

## What survives, and what does not

Nothing you care about lives in the checkout. It all lives in two places the
installer does not touch:

| Lives in | Contains | Survives a reinstall |
| --- | --- | --- |
| `%USERPROFILE%\.codex\codex-router\` | provider credentials (`*.secret`), OAuth sessions, `merged-models.json`, usage history | yes |
| `%USERPROFILE%\.codex\config.toml` | Codex's own settings and the managed router block | yes, rewritten in place |
| `%LOCALAPPDATA%\codex-router\` | the code | replaced |

So a reinstall costs you no keys and no history. What it does replace is any
edit made directly inside the install directory.

## Before you start

**1. Capture anything you changed in the install tree.**

```powershell
cd $env:LOCALAPPDATA\codex-router
git status --short --untracked-files=no
git diff > $env:USERPROFILE\Desktop\pre-deploy-local-edits.patch
```

If `git status` lists files, read the patch before continuing. Edits made in
that directory exist nowhere else, and the reinstall overwrites them.

**2. Note which providers are connected**, so you can tell afterwards whether
anything was lost:

```powershell
cd $env:LOCALAPPDATA\codex-router
.\codex-router.ps1 providers
```

Write down the `SHOW ... ready` rows.

**3. Stop the running router.** A live process holds port 4102, and an
installer that cannot bind it leaves a task that reports Ready while never
starting - the deadlock that once left a router running unsupervised for
sixteen hours.

```powershell
.\codex-router.ps1 disable
$routerPid = (Get-NetTCPConnection -LocalPort 4102 -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1).OwningProcess
if ($routerPid) { Stop-Process -Id $routerPid -Force; Start-Sleep -Seconds 2 }
Get-Process codex-router-desktop -ErrorAction SilentlyContinue | Stop-Process -Force
```

Quit Codex and the ChatGPT desktop app too.

## Deploy

```powershell
git clone -b claude/openrouter-deepseek-handoff-s1gfej `
  https://github.com/rendez2k/nexus $env:USERPROFILE\Documents\nexus-deploy
cd $env:USERPROFILE\Documents\nexus-deploy
.\install.ps1 -CheckoutInstall -Target codex
```

`-CheckoutInstall` installs from the checkout you are standing in rather than
cloning upstream. That distinction is the whole point of this guide: the old
install's `origin` pointed at `duolahypercho/codex-router`, so `bin/update` and
`git pull` inside it fetched someone else's tree.

## Verify, in this order

```powershell
cd $env:LOCALAPPDATA\codex-router
.\codex-router.ps1 doctor 2>&1 | Select-String -Pattern '^FAIL' -Context 0,1
```

**No output means every check passed.** If `Background service: ready` appears,
the port is still held - repeat the stop step above and run
`.\codex-router.ps1 enable`.

Then confirm the catalog and that your providers came back:

```powershell
node src\catalog.mjs
.\codex-router.ps1 providers
```

`routed_models` should match the number of models you expect, and the
`SHOW ... ready` rows should match what you wrote down earlier. A provider that
has become `setup needed` lost its credential; re-add it with
`.\codex-router.ps1 provider-key`, which prompts invisibly - never paste a key
into a chat or a script.

Finally, fully quit and reopen Codex. The routed models appear in the Codex
surface, not in the ChatGPT chat tab, which lists OpenAI's own models and
ignores the router entirely.

## The tray

The tray is a separate, optional artifact. It is the only compiled part of the
project, and it changes nothing about routing.

```powershell
& $env:USERPROFILE\Documents\nexus-deploy\scripts\windows\nexus-tray.ps1
```

That downloads the latest CI build, installs it to `%LOCALAPPDATA%\Nexus\tray`,
and starts it. Re-running it is the update: the download is compared by hash and
only replaces the local copy when the build actually changed.

Do not install it with `bin/model-router-tray`. That path fingerprints the
tray's *source* files and compares them against a stamp beside the binary, so a
downloaded build always reads as stale and it tries to rebuild from source -
which needs Rust and cargo.

## Rolling back

Routing can be switched off without uninstalling anything:

```powershell
cd $env:LOCALAPPDATA\codex-router
node src\config-manager.mjs disable
```

Restart Codex and it behaves as though the router were never installed, with
every OpenAI model back. `node src\config-manager.mjs enable` restores routing.
Keep the old install directory until you are satisfied; it can be renamed rather
than deleted, and `install.ps1` will not read it.

## Afterwards

The deployed tree is now a clone of `rendez2k/nexus`, so `git pull` inside it
means what you would expect. Two habits keep it that way:

- Change code in the checkout and pull, rather than editing inside
  `%LOCALAPPDATA%\codex-router`. Edits made there are invisible to every
  repository and are lost on the next install.
- Take upstream through a sync of this repository rather than by pulling
  upstream into the install. `docs/RENAME.md` records which identifiers must
  not move, and the test suite is what proves a sync did not drop anything.
