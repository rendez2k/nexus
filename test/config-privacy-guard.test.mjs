import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  GUARD_DISABLE_ENV,
  configPrivacyGuardDisabled,
  startConfigPrivacyGuard,
} from "../src/config-privacy-guard.mjs";

// POSIX modes stand in for the Windows ACL: protectPrivateFile is chmod 600
// here and icacls there, and the guard only ever calls that one function.
const posixOnly = { skip: process.platform === "win32" };

function mode(target) {
  return statSync(target).mode & 0o777;
}

function settle(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function eventually(predicate, { timeoutMs = 3_000, stepMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await settle(stepMs);
  }
  return predicate();
}

test("an exposed config is relocked without its content being touched", posixOnly, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "nexus-privacy-guard-"));
  const target = path.join(directory, "config.toml");
  const contents = 'model = "gpt-6-astra"\nopenai_base_url = "http://127.0.0.1:4202/_codex-router/x/v1"\n';
  const log = [];
  writeFileSync(target, contents);
  chmodSync(target, 0o644);
  const guard = startConfigPrivacyGuard({
    target,
    debounceMs: 20,
    pollMs: 60_000,
    log: (message) => log.push(message),
  });
  try {
    assert.ok(await eventually(() => mode(target) === 0o600), "initial check relocks the file");
    assert.equal(readFileSync(target, "utf8"), contents, "content is never rewritten");
    assert.equal(guard.relocks, 1);
    assert.match(log[0], /relocked/);
  } finally {
    guard.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a rewrite by the client is relocked after the burst settles", posixOnly, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "nexus-privacy-guard-"));
  const target = path.join(directory, "config.toml");
  writeFileSync(target, "model = \"a\"\n", { mode: 0o600 });
  const guard = startConfigPrivacyGuard({ target, debounceMs: 20, pollMs: 60_000 });
  try {
    await settle(60);
    assert.equal(guard.relocks, 0, "a file that is already locked is left alone");

    // Codex writes a temporary file and renames it over the target, which
    // yields a fresh inode with the directory's default permissions.
    const temporary = path.join(directory, "config.toml.tmp");
    writeFileSync(temporary, "model = \"b\"\n", { mode: 0o644 });
    const { renameSync } = await import("node:fs");
    renameSync(temporary, target);
    assert.equal(mode(target), 0o644, "the rewrite dropped the lock, as Codex's does");

    assert.ok(await eventually(() => mode(target) === 0o600), "relocked after the rename");
    assert.equal(readFileSync(target, "utf8"), "model = \"b\"\n", "the client's new content survives");
    assert.equal(guard.relocks, 1);
  } finally {
    guard.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a missing file is never created, and polling covers a dead watcher", posixOnly, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "nexus-privacy-guard-"));
  const target = path.join(directory, "config.toml");
  const guard = startConfigPrivacyGuard({
    target,
    debounceMs: 10,
    pollMs: 30,
    watchImpl: () => {
      throw new Error("no inotify here");
    },
  });
  try {
    assert.equal(guard.watching, false);
    await settle(80);
    assert.equal(statSync(directory).isDirectory(), true);
    assert.throws(() => statSync(target), "nothing created the file");

    writeFileSync(target, "x = 1\n");
    chmodSync(target, 0o644);
    assert.ok(await eventually(() => mode(target) === 0o600), "the poll alone relocks it");
  } finally {
    guard.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stop ends both the watcher and the poll", posixOnly, async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "nexus-privacy-guard-"));
  const target = path.join(directory, "config.toml");
  writeFileSync(target, "x = 1\n", { mode: 0o600 });
  const guard = startConfigPrivacyGuard({ target, debounceMs: 10, pollMs: 20 });
  guard.stop();
  chmodSync(target, 0o644);
  await settle(120);
  try {
    assert.equal(mode(target), 0o644, "a stopped guard changes nothing");
    assert.equal(guard.relocks, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an unknown protection state is left alone rather than relocked on a guess", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "nexus-privacy-guard-"));
  const target = path.join(directory, "config.toml");
  writeFileSync(target, "x = 1\n");
  let protectCalls = 0;
  const guard = startConfigPrivacyGuard({
    target,
    debounceMs: 10,
    pollMs: 60_000,
    protection: () => "unknown",
    protect: () => {
      protectCalls += 1;
    },
  });
  try {
    await settle(60);
    assert.equal(protectCalls, 0);
  } finally {
    guard.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the guard can be switched off, and only by an explicit zero", () => {
  assert.equal(configPrivacyGuardDisabled({}), false);
  assert.equal(configPrivacyGuardDisabled({ [GUARD_DISABLE_ENV]: "1" }), false);
  assert.equal(configPrivacyGuardDisabled({ [GUARD_DISABLE_ENV]: "0" }), true);
});
