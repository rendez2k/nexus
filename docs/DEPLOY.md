# Getting Nexus running on Windows

Ten minutes, six steps, one folder. Read the first section once so the rest
makes sense; after that, just do the steps in order.

## Three folders, and what is in them

| Folder | Holds | The steps below |
| --- | --- | --- |
| `%LOCALAPPDATA%\codex-router` | **the code** | replace it |
| `%USERPROFILE%\.codex\codex-router\` | your API keys, sign-ins, model list, usage history, `router.log` | never touched |
| `%USERPROFILE%\.codex\config.toml` | Codex's own settings | rewritten in place, keys preserved |

Nothing you care about lives in the code folder, so replacing it costs you no
keys and no history.

The code has to live in that exact folder. The tray looks there, `doctor` looks
there, and the background service is written to point wherever `install.ps1`
was run from. An earlier attempt installed from `Documents\nexus-deploy`; that
is why the tray could not find it.

## Before you start

You need Git, Node.js 22.19 or newer, and either `uv` or Python 3.10+. Check all
three in one go (this is written for the Windows PowerShell 5.1 that ships with
Windows; it also works in PowerShell 7):

```powershell
git --version; node --version
if (Get-Command uv -ErrorAction SilentlyContinue) { uv --version }
elseif (Get-Command py -ErrorAction SilentlyContinue) { py -3 --version }
else { "no uv or python" }
```

If any line errors, install the missing one first (Node from nodejs.org, Git
from git-scm.com, uv from docs.astral.sh/uv). Everything below assumes a normal
PowerShell window, not an administrator one.

## Step 1 - stop everything

Quit Codex fully (right-click its tray icon, Quit - closing the window is not
enough). Then:

```powershell
Get-Process codex-router-desktop -ErrorAction SilentlyContinue | Stop-Process -Force
schtasks /End /TN "Codex Router" 2>$null
foreach ($p in 4100,4101,4102,4103,4200,4201,4202,4203) {
  $owner = (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1).OwningProcess
  if ($owner) { Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 3
```

This stops the tray, the background task, and any router still holding a port.
Both port ranges are listed because an older install used 4100-4103 and this
one uses 4200-4203, and a half-migrated machine has one of each.

## Step 2 - move the old code aside

```powershell
Rename-Item $env:LOCALAPPDATA\codex-router codex-router-old
```

If this says the folder is in use, wait ten seconds and run step 1 again.
Keeping it under a new name (rather than deleting it) is what lets you go back.

## Step 3 - fetch the new code into the right folder

```powershell
git clone -b claude/openrouter-deepseek-handoff-s1gfej https://github.com/rendez2k/nexus $env:LOCALAPPDATA\codex-router
```

## Step 4 - install

```powershell
cd $env:LOCALAPPDATA\codex-router
.\install.ps1 -CheckoutInstall -Target codex
```

This installs Node packages, installs the Python gateway (the longest part - a
few minutes), rewrites the Codex config, registers the background task, and
starts it. Your keys are found automatically; it will not ask for them.

**It ends well when you see:**

```
Installed the selected external model routes. Fully quit and reopen Codex.
```

**It ends badly when you see** `Router did not become healthy within 300
seconds`. Go to "If step 4 fails" below - do not run the install again yet.

## Step 5 - check

```powershell
.\codex-router.ps1 doctor
```

Every line should read `OK` or `WARN`. A `WARN` on a provider you never set up
is normal. Any `FAIL` is not - the line under it says what to do.

## Step 6 - open Codex

Fully quit Codex and reopen it. Your routed models are in the Codex model
picker (not the ChatGPT chat tab, which only ever lists OpenAI's own models).

That is the whole install. The two sections below are for the tray and for
when something goes wrong.

## The tray (optional)

The tray is a separate download and changes nothing about routing. It shows
usage and lets you toggle providers.

```powershell
& "$env:LOCALAPPDATA\codex-router\scripts\windows\Nexus Tray.bat"
```

Run that same file again any time to update it; it only replaces the tray when
the build actually changed. Make a Desktop shortcut to it if you like.

Do not use `.\codex-router.ps1 tray`, which tries to compile the tray from
source and needs Rust.

## If step 4 fails

The one thing that tells you why is the log. Read the **last** lines only -
the file is shared with every previous install, so anything older than a few
minutes belongs to a router that no longer exists:

```powershell
Get-Content $env:USERPROFILE\.codex\codex-router\router.log -Tail 40
```

What it usually says, and what it means:

- **Nothing new at all.** Windows never ran the task. Run
  `schtasks /Query /TN "Codex Router" /V /FO LIST` and look at `Last Result`.
- **A Python traceback, or `LiteLLM gateway` never reported healthy.** The
  gateway on port 4200 failed, so the router never opened 4202. Run
  `.\codex-router.ps1 doctor`; it names the broken piece.
- **`LiteLLM is not installed` or `virtual environment is broken`.** The
  Python install did not finish. Run `.\install.ps1 -CheckoutInstall -ForceDeps`.
- **Anything mentioning a proxy.** Run
  `Get-ChildItem env: | Where-Object Name -match 'PROXY'`. A proxy variable
  that captures loopback traffic makes the health check fail against a router
  that is actually fine.

Two things that look like failures and are not:

- **The model picker shows your routed models but the tray says "Router
  offline".** The picker reads a file that the installer writes before it starts
  anything, so a full picker only proves the config landed - it says nothing
  about whether the router is running. Trust the tray, and read the log.
- **The tray's Connections tab shows "Add key" on providers.** That tab lists
  all 37 providers alphabetically, connected or not. Scroll down to yours, or
  run `.\codex-router.ps1 providers` and look for `ready`.

## Updating later

This folder is a normal clone of `rendez2k/nexus`, so updating is a pull and a
reinstall:

```powershell
cd $env:LOCALAPPDATA\codex-router
git pull
.\install.ps1 -CheckoutInstall -Target codex
```

`.\codex-router.ps1 update` will refuse with "origin remote is not a recognized
Codex Router repository". That is correct: it only knows the upstream project
and would otherwise pull someone else's tree over yours.

## Going back

Turn routing off without uninstalling anything:

```powershell
cd $env:LOCALAPPDATA\codex-router
node src\config-manager.mjs disable
```

Restart Codex and it behaves as if the router were never there. `node
src\config-manager.mjs enable` puts it back. The previous code is still in
`codex-router-old` if you ever need it.

## Cleaning up, once it all works

```powershell
Remove-Item -Recurse -Force $env:LOCALAPPDATA\codex-router-old
Remove-Item -Recurse -Force $env:USERPROFILE\Documents\nexus-deploy -ErrorAction SilentlyContinue
```

The second folder is the earlier install attempt; it holds a gigabyte of
Python packages and nothing else.
