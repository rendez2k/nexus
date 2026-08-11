import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PROTECTION_EXPOSED,
  PROTECTION_PROTECTED,
  PROTECTION_UNKNOWN,
  privateFileIsProtected,
  privateFileProtection,
  protectPrivateFile,
  windowsFullControlGrant,
} from "../src/file-security.mjs";

test("Windows numeric SID grants use the icacls SID prefix", () => {
  assert.equal(
    windowsFullControlGrant("S-1-5-21-1742564184-1656218818-310408600-500"),
    "*S-1-5-21-1742564184-1656218818-310408600-500:(F)",
  );
  assert.throws(() => windowsFullControlGrant("runner@example.com"), /invalid Windows user SID/);
});

test(
  "Windows private-file ACL is protected for the current identity",
  { skip: process.platform !== "win32" },
  () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "codex-router-acl-"));
    const target = path.join(directory, "private.secret");
    writeFileSync(target, "TEST_ONLY\n");
    try {
      protectPrivateFile(target);
      const script = [
        "$acl = [System.IO.File]::GetAccessControl($env:CODEX_ROUTER_PRIVATE_FILE)",
        "$identity = [Security.Principal.WindowsIdentity]::GetCurrent()",
        "$rules = @($acl.Access | ForEach-Object { [pscustomobject]@{ identity = $_.IdentityReference.Value; type = $_.AccessControlType.ToString(); inherited = $_.IsInherited } })",
        "[pscustomobject]@{ protected = $acl.AreAccessRulesProtected; currentSid = $identity.User.Value; currentName = $identity.Name; rules = $rules } | ConvertTo-Json -Compress -Depth 4",
      ].join("; ");
      const acl = execFileSync(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        {
          encoding: "utf8",
          env: { ...process.env, CODEX_ROUTER_PRIVATE_FILE: target },
        },
      ).trim();
      assert.equal(privateFileIsProtected(target), true, acl);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

// A shell that fails to start must not be reported as an exposed file. Doctor
// renders "exposed" as a FAIL claiming the caller capability in config.toml is
// readable by anyone, which reads as a credential leak and invites a rotation
// that fixes nothing.
test("protection state distinguishes an unreadable ACL from an exposed file", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "nexus-protection-"));
  try {
    const target = path.join(directory, "config.toml");
    writeFileSync(target, "openai_base_url = \"http://127.0.0.1:4102/_codex-router/x/v1\"\n");

    assert.equal(privateFileProtection(path.join(directory, "absent.toml")), PROTECTION_EXPOSED);

    protectPrivateFile(target);
    const state = privateFileProtection(target);
    assert.ok(
      [PROTECTION_PROTECTED, PROTECTION_UNKNOWN].includes(state),
      `a protected file must never read as exposed, got ${state}`,
    );

    // The boolean wrapper stays strict: only a definite yes counts, so callers
    // that gate on it keep failing closed.
    assert.equal(privateFileIsProtected(target), state === PROTECTION_PROTECTED);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the three protection states are distinct", () => {
  assert.equal(
    new Set([PROTECTION_PROTECTED, PROTECTION_EXPOSED, PROTECTION_UNKNOWN]).size,
    3,
  );
});
