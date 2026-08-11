$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Target = if ($env:MODEL_ROUTER_TARGET) { $env:MODEL_ROUTER_TARGET } else { "codex" }
if ($Target -ne "codex") {
  throw "MODEL_ROUTER_TARGET must be codex."
}
$Command = if ($args.Count) { [string]$args[0] } else { "status" }
$Arguments = if ($args.Count -gt 1) { @($args[1..($args.Count - 1)]) } else { @() }
$Commands = @(
  "setup", "install", "doctor", "status", "providers", "provider-key", "enable",
  "disable", "uninstall", "update", "rollback", "support-bundle",
  "smoke-test", "start", "test-model", "discover-models", "refresh-catalog"
)
if ($Command -notin $Commands) {
  throw "Unknown command '$Command'. Choose: $($Commands -join ', ')."
}
function Invoke-RouterNode([string]$Script, [string[]]$ScriptArguments = @()) {
  & node (Join-Path $Root $Script) @ScriptArguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Script exited with status $LASTEXITCODE."
  }
}

switch ($Command) {
  "setup" {
    Invoke-RouterNode "src\setup.mjs" $Arguments
  }
  "doctor" {
    Invoke-RouterNode "src\doctor.mjs" $Arguments
  }
  "status" {
    Invoke-RouterNode "src\doctor.mjs" $Arguments
  }
  "providers" { Invoke-RouterNode "src\providers.mjs" $Arguments }
  "provider-key" { Invoke-RouterNode "src\provider-key.mjs" $Arguments }
  # `bin/install` accepts --prepare-only/--migrate-known/--force-deps, so the
  # Windows wrapper has to pass the equivalent switches through instead of
  # dropping them; `./model-router.ps1 codex install -ForceDeps` was silently
  # running a plain install.
  "install" { & (Join-Path $Root "install.ps1") -CheckoutInstall -Target $Target @Arguments }
  "enable" { & (Join-Path $Root "install.ps1") -CheckoutInstall -Target $Target @Arguments }
  "disable" {
    Invoke-RouterNode "src\config-manager.mjs" @("disable")
    Invoke-RouterNode "src\service.mjs" @("uninstall")
  }
  "uninstall" {
    Invoke-RouterNode "src\config-manager.mjs" @("disable")
    Invoke-RouterNode "src\service.mjs" @("uninstall")
  }
  "update" {
    # `update check` stays a read-only comparison; a bare `update` installs.
    $UpdateArguments = if ($Arguments.Count) { $Arguments } else { @("update") }
    Invoke-RouterNode "src\update.mjs" $UpdateArguments
  }
  "rollback" {
    # The subcommand is fixed, so the caller's flags are appended to it rather
    # than replacing it -- the shape `bin/rollback` uses (`update.mjs rollback
    # "$@"`). Hardcoding the list here made `rollback --force` unreachable on
    # Windows, which is the only way past tracked edits that block a rollback.
    Invoke-RouterNode "src\update.mjs" (@("rollback") + $Arguments)
  }
  "support-bundle" { Invoke-RouterNode "src\support-bundle.mjs" $Arguments }
  "smoke-test" {
    Invoke-RouterNode "src\smoke-test.mjs" $Arguments
  }
  "start" { Invoke-RouterNode "src\start.mjs" $Arguments }
  "test-model" { Invoke-RouterNode "src\compatibility-test.mjs" $Arguments }
  "discover-models" { Invoke-RouterNode "src\model-discovery.mjs" $Arguments }
  "refresh-catalog" {
    # The native capture has to happen with the router disabled: catalog.mjs
    # refuses to snapshot an already-merged catalog, so refreshing while routing
    # is live silently reuses the stale cache. bin/refresh-catalog does this on
    # POSIX; without it here the operation was four hand-typed commands.
    #
    # The finally block is the point of the command. An interrupted refresh that
    # left the router disabled would take every routed model out of the picker
    # and look exactly like the catalog having been wiped.
    $status = & node (Join-Path $Root "src\config-manager.mjs") "status" | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw "config-manager.mjs status exited with status $LASTEXITCODE." }
    $restore = $status.mode -eq "router"
    try {
      if ($restore) { Invoke-RouterNode "src\config-manager.mjs" @("disable") | Out-Null }
      Invoke-RouterNode "src\catalog.mjs" (@("--refresh-native", "--bundled-native") + $Arguments)
    } finally {
      if ($restore) {
        # Restoring matters more than the refresh succeeding, so a failure here
        # is reported rather than thrown - a throw inside finally would replace
        # the original error and hide why the refresh failed.
        try { Invoke-RouterNode "src\config-manager.mjs" @("enable") | Out-Null }
        catch { Write-Warning "Could not re-enable routing: $_. Run: node src\config-manager.mjs enable" }
      }
    }
    Write-Output "Native and external model catalogs refreshed. Fully quit and reopen Codex."
  }
}

exit 0
