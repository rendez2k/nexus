# Windows and Linux tray app

The desktop tray app brings the Model Router activity surface to Windows and
Linux without changing the native macOS app. It uses the same local control
plane and health endpoint as the command line, so provider selection, quota
data, and token history stay consistent across surfaces.

## Platform behavior

| Platform | Tray panel | Top-center activity pill | Open behavior |
| --- | --- | --- | --- |
| Windows 10/11 | Yes | Yes | Left-click the tray icon or use its menu |
| Linux on X11 | Yes | Yes | Use **Open Model Router** in the tray menu |
| Linux on Wayland | Yes | Disabled | Use **Open Model Router** in the tray menu |

Wayland intentionally uses the tray-only fallback. Compositors control absolute
window placement, so claiming a stable top-center pill would create inconsistent
behavior across GNOME, KDE, Sway, and other compositors. The panel explains this
and disables its activity-pill switch; router monitoring continues normally.

## What it shows

- The compact pill shows router state, the active model, today's tokens, and
  the active provider's weekly percentage.
- Hovering the pill expands a seven-day daily token graph. The series is
  refreshed in the background rather than recalculated on every hover.
- The panel shows the same daily graph at a larger size. Hover any point for
  its date and exact token count.
- Quota cards use one **Weekly limit** label and one reset line. A reported
  five-hour window appears as its own **5-hour limit** card.
- Provider cards are absent until that provider has a usable OAuth session or
  API key. Unconnected providers remain available only in **Connections**.
- **Connections** includes a **Use without OpenAI login** switch for new Codex
  sessions. It requires a connected, enabled external provider and restores the
  prior model-provider setting when switched off.
- **Models** has three accordions. **Apps** chooses which editors receive the
  selected models, **Subagent models** exposes every enabled model, or only
  selected models, as Codex v2 subagent overrides, and **Model picker** hides or
  shows individual models without changing their provider connection.

## Apps: Codex and Claude Code

Codex always receives the selected models through its merged catalog. Claude
Code is off by default and works differently: it has no catalog file, so the
switch writes `ANTHROPIC_BASE_URL`, a credential, and
`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` into the user-scoped
`~/.claude/settings.json` (`%USERPROFILE%\.claude\settings.json` on Windows) and
Claude Code then discovers the models over HTTP at startup. Every other setting
in that file is preserved, and switching off removes only those three keys.

Hiding a model in **Model picker** withholds it from both apps, so the two
surfaces cannot drift apart.

Claude Code keeps a discovered model only when its id contains `claude` or
`anthropic`, so routed models are published under an `anthropic-router/` prefix
with their real name in `display_name`. Without it, most routed models would be
dropped from the picker with no error.

Turning the switch on has consequences worth stating plainly:

- Claude Code stops using the claude.ai subscription and bills each request to
  the provider behind the router.
- Remote Control and voice dictation become unavailable, and `/fast` reports
  unavailable, because those check `api.anthropic.com` directly.
- Anthropic does not support routing Claude Code to non-Claude models through
  any gateway.

Claude Code must be fully restarted after the switch changes. Routed Claude Code
turns are not yet metered into the token graphs, which currently cover Codex
traffic only.

The status mark uses Thinking Orbs **Shaping** while idle, **Thinking** while a
model is generating, and **Solving** for errors. Starting retains its colored
status dot, and the Error label remains explicit. A low-contrast edge signal
appears only while generating. The app honors the system's reduced-motion
preference.

## Build prerequisites

- Node.js 22.19 or newer
- Rust stable and Cargo
- The normal Model Router checkout and its installed npm dependencies

On Debian or Ubuntu, install Tauri's native libraries first:

```sh
sudo apt-get update
sudo apt-get install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

The build scripts only report missing prerequisites; they do not install a
system runtime or package manager.

## Build and run

Linux:

```sh
./scripts/build-desktop-tray.sh
./bin/model-router-tray
```

The first command creates the native packages supported by the current Linux
host. The second builds a release binary when needed and starts it. For a faster
unbundled build, use `./scripts/build-desktop-tray.sh --binary-only`.

Windows PowerShell:

```powershell
.\scripts\build-desktop-tray.ps1
Start-Process .\apps\desktop\src-tauri\target\release\codex-router-desktop.exe
```

Pass `-BinaryOnly` for an unbundled executable. Installer artifacts are written
under `apps\desktop\src-tauri\target\release\bundle` by a full build.

## Refreshing the model catalog

```powershell
.\codex-router.ps1 refresh-catalog
```

or `./bin/refresh-catalog` on POSIX. Both run `src/refresh-catalog.mjs`, which
disables routing, recaptures Codex's native catalog, then restores routing -
including when the refresh itself fails.

Do not hand-run `catalog.mjs --refresh-native` with routing enabled: it refuses
to snapshot an already-merged catalog and silently reuses the stale capture.

## Windows without a toolchain

Building locally needs Node, npm and cargo. If you would rather not install
Rust, take the CI build instead:

```powershell
.\scripts\windows\nexus-tray.ps1
```

or double-click `scripts\windows\Nexus Tray.bat`. It pulls the executable from
the rolling `tray-latest` prerelease that `.github/workflows/build-windows.yml`
publishes, installs it to `%LOCALAPPDATA%\Nexus\tray`, and starts it. Re-running
it is the update: the download is compared by hash and only replaces the local
copy when the build has actually changed. Pass `-NoLaunch` to update in place.

For a Desktop shortcut carrying the Nexus icon, run this once, adjusting the
checkout path:

```powershell
$checkout = "$env:USERPROFILE\Documents\nexus"
$link = (New-Object -ComObject WScript.Shell).CreateShortcut("$env:USERPROFILE\Desktop\Nexus Tray.lnk")
$link.TargetPath = "$checkout\scripts\windows\Nexus Tray.bat"
$link.WorkingDirectory = "$checkout\scripts\windows"
$link.IconLocation = "$checkout\assets\icon\nexus.ico"
$link.Save()
```

Shortcut rather than a copy of the `.bat`: the batch file calls the PowerShell
script sitting next to it, so moving it on its own breaks that reference.

This route deliberately bypasses `bin/model-router-tray`, which fingerprints
the tray's source files and compares them against a stamp beside the binary. A
downloaded build always reads as stale to it, so it would try to rebuild from
source - exactly the toolchain you were avoiding.

The app discovers the router checkout from `MODEL_ROUTER_SOURCE_ROOT`, a saved
bundle pointer, the source tree during development, or the standard install
location (`%LOCALAPPDATA%\codex-router` on Windows and
`~/.local/share/codex-router` on Linux). It displays a useful offline state when
the checkout or router service is unavailable.

## Credential safety

The webview cannot start arbitrary shell commands. Its backend exposes only a
small, validated command set for known provider IDs. API keys cross the local
Tauri IPC boundary once and are written to the router control process through
standard input; they are never placed in process arguments, logs, settings, or
the UI after submission. If applying a provider change fails, the previous
provider selection is restored.

Windows and Linux builds run in CI on every change. UI data shaping and chart
behavior have platform-neutral Node tests, while the Rust tests cover provider
validation, health parsing, and multi-monitor placement math.

## Troubleshooting: WebKitGTK crashes on NVIDIA

WebKitGTK's DMA-BUF renderer shares GPU buffers with the Wayland compositor
(Hyprland, GNOME, KDE, ...) through the graphics driver. With the proprietary
NVIDIA kernel driver that handoff crashed (SIGSEGV in `libnvidia-eglcore.so`
on the `SkiaGPUWorker` thread) as soon as the tray panel was shown, which also
took down the tray app.

The companion now detects the proprietary NVIDIA kernel driver via
`/proc/driver/nvidia/version` and disables only the DMA-BUF renderer
(`WEBKIT_DISABLE_DMABUF_RENDERER=1`) before the webviews are created, falling
back to `wl_shm`. Accelerated compositing stays enabled, and non-NVIDIA
systems keep the DMA-BUF fast path. Set `CODEX_ROUTER_WEBKIT_DMABUF=1` to
force the renderer back on (for example after a driver update fixes the
crash) or `CODEX_ROUTER_WEBKIT_DMABUF=0` to force it off on any system.

To reproduce the exact window-show path in a smoke test, start the binary with
`CODEX_ROUTER_SHOW_PANEL=1`; the panel opens on startup instead of waiting for
a tray interaction.
