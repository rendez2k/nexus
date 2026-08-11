import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, statSync } from "node:fs";

let windowsSid;

function currentWindowsSid() {
  if (windowsSid) return windowsSid;
  const script =
    "[Console]::Out.Write([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)";
  windowsSid = execFileSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  ).trim();
  if (!windowsSid) throw new Error("Could not resolve the current Windows user SID.");
  return windowsSid;
}

export function windowsFullControlGrant(sid) {
  if (!/^S-\d+(?:-\d+)+$/i.test(sid)) {
    throw new Error("Could not format an invalid Windows user SID.");
  }
  // icacls requires an asterisk before a numeric SID so it is not resolved as
  // an account name. Without it, hosted runners fail with system error 1332.
  return `*${sid}:(F)`;
}

export function protectPrivateFile(target) {
  chmodSync(target, 0o600);
  if (process.platform !== "win32") return target;
  const sid = currentWindowsSid();
  execFileSync(
    "icacls.exe",
    [target, "/inheritance:r", "/grant:r", windowsFullControlGrant(sid)],
    { stdio: "ignore" },
  );
  return target;
}

// A protection check has three outcomes, not two. Collapsing the third into
// "exposed" turns a shell that failed to start into a report that the caller
// capability in config.toml is readable by anyone, which reads as a credential
// leak and invites a pointless rotation.
export const PROTECTION_PROTECTED = "protected";
export const PROTECTION_EXPOSED = "exposed";
export const PROTECTION_UNKNOWN = "unknown";

function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function privateFileProtection(target) {
  if (!existsSync(target)) return PROTECTION_EXPOSED;
  if (process.platform !== "win32") {
    return (statSync(target).mode & 0o777) === 0o600 ? PROTECTION_PROTECTED : PROTECTION_EXPOSED;
  }
  const script = [
    // Get-Acl lazy-loads Microsoft.PowerShell.Security, which can fail under
    // concurrent Windows processes. The .NET API returns the same FileSecurity
    // object without importing a PowerShell module.
    "$acl = [System.IO.File]::GetAccessControl($env:CODEX_ROUTER_PRIVATE_FILE)",
    "$identity = [Security.Principal.WindowsIdentity]::GetCurrent()",
    "$sid = $identity.User.Value",
    "$name = $identity.Name",
    "$allowed = $false",
    "foreach ($rule in $acl.Access) { $ruleIdentity = $rule.IdentityReference.Value; $matches = $ruleIdentity -eq $sid -or $ruleIdentity -eq $name; if (-not $matches) { try { $matches = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $sid } catch { $matches = $false } }; if ($matches -and $rule.AccessControlType -eq 'Allow') { $allowed = $true } }",
    "[Console]::Out.Write(($acl.AreAccessRulesProtected -and $allowed).ToString())",
  ].join("; ");
  // The documented failure above is concurrency-related and therefore
  // transient, so one retry converts most spurious unknowns into an answer.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const answer = execFileSync(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        {
          encoding: "utf8",
          env: { ...process.env, CODEX_ROUTER_PRIVATE_FILE: target },
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim().toLowerCase();
      if (answer === "true") return PROTECTION_PROTECTED;
      if (answer === "false") return PROTECTION_EXPOSED;
      return PROTECTION_UNKNOWN;
    } catch {
      if (attempt === 0) pause(250);
    }
  }
  return PROTECTION_UNKNOWN;
}

// Retained for the callers that only act on a definite yes. Everything that
// reports to a user should read privateFileProtection instead, so "could not
// check" does not masquerade as "exposed".
export function privateFileIsProtected(target) {
  return privateFileProtection(target) === PROTECTION_PROTECTED;
}
