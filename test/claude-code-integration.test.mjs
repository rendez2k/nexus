import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MANAGED_ENV_KEYS,
  applyClaudeCodeEnv,
  claudeCodeTargetStatus,
  claudeSettingsPath,
  readClaudeSettings,
  removeClaudeCodeEnv,
  writeClaudeSettings,
} from "../src/claude-code-integration.mjs";

const BASE_URL = "http://127.0.0.1:8712/_codex-router/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CALLER_KEY = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

test("enabling adds only the managed keys and preserves unrelated settings", () => {
  const before = {
    model: "sonnet",
    permissions: { allow: ["Bash(npm test)"] },
    env: { HTTP_PROXY: "http://corp.example", ANTHROPIC_CUSTOM_HEADERS: "X-Team: infra" },
  };

  const after = applyClaudeCodeEnv(before, { baseUrl: BASE_URL, callerKey: CALLER_KEY });

  assert.equal(after.model, "sonnet");
  assert.deepEqual(after.permissions, { allow: ["Bash(npm test)"] });
  assert.equal(after.env.HTTP_PROXY, "http://corp.example");
  assert.equal(after.env.ANTHROPIC_CUSTOM_HEADERS, "X-Team: infra");
  assert.equal(after.env.ANTHROPIC_BASE_URL, BASE_URL);
  assert.equal(after.env.ANTHROPIC_AUTH_TOKEN, CALLER_KEY);
  assert.equal(after.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, "1");
});

test("enabling does not mutate the settings object it was given", () => {
  const before = { env: { HTTP_PROXY: "http://corp.example" } };
  applyClaudeCodeEnv(before, { baseUrl: BASE_URL, callerKey: CALLER_KEY });
  assert.deepEqual(before, { env: { HTTP_PROXY: "http://corp.example" } });
});

test("disabling removes every managed key and nothing else", () => {
  const enabled = applyClaudeCodeEnv(
    { model: "sonnet", env: { HTTP_PROXY: "http://corp.example" } },
    { baseUrl: BASE_URL, callerKey: CALLER_KEY },
  );

  const disabled = removeClaudeCodeEnv(enabled);

  assert.equal(disabled.model, "sonnet");
  assert.deepEqual(disabled.env, { HTTP_PROXY: "http://corp.example" });
  for (const key of MANAGED_ENV_KEYS) {
    assert.equal(key in disabled.env, false, `${key} survived disable`);
  }
});

test("enable then disable returns a previously unconfigured file to its original shape", () => {
  const original = { env: {} };
  const roundTripped = removeClaudeCodeEnv(
    applyClaudeCodeEnv(original, { baseUrl: BASE_URL, callerKey: CALLER_KEY }),
  );
  assert.deepEqual(roundTripped, original);
});

test("a stale base URL is reported rather than passing as configured", () => {
  const stale = applyClaudeCodeEnv({}, { baseUrl: "http://127.0.0.1:1/old", callerKey: CALLER_KEY });
  const status = claudeCodeTargetStatus(stale, { baseUrl: BASE_URL });

  assert.equal(status.configured, true);
  assert.equal(status.baseUrlMatches, false);
});

test("a settings file with no env block reports as unconfigured", () => {
  const status = claudeCodeTargetStatus({ model: "sonnet" }, { baseUrl: BASE_URL });
  assert.equal(status.configured, false);
  assert.equal(status.discoveryEnabled, false);
});

test("enabling requires both a base URL and a caller key", () => {
  assert.throws(() => applyClaudeCodeEnv({}, { callerKey: CALLER_KEY }), /base URL/);
  assert.throws(() => applyClaudeCodeEnv({}, { baseUrl: BASE_URL }), /caller key/);
});

test("settings survive a real read/write round trip with comments-free JSON", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "claude-settings-"));
  const target = path.join(dir, "settings.json");
  writeFileSync(target, JSON.stringify({ model: "sonnet", env: { KEEP: "1" } }, null, 2));

  const updated = applyClaudeCodeEnv(readClaudeSettings(target), {
    baseUrl: BASE_URL,
    callerKey: CALLER_KEY,
  });
  writeClaudeSettings(target, updated);

  const reread = readClaudeSettings(target);
  assert.equal(reread.model, "sonnet");
  assert.equal(reread.env.KEEP, "1");
  assert.equal(reread.env.ANTHROPIC_BASE_URL, BASE_URL);
  assert.match(readFileSync(target, "utf8"), /\n$/);
});

test("a missing or empty settings file reads as an empty object", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "claude-settings-"));
  assert.deepEqual(readClaudeSettings(path.join(dir, "settings.json")), {});

  const empty = path.join(dir, "empty.json");
  writeFileSync(empty, "   ");
  assert.deepEqual(readClaudeSettings(empty), {});
});

test("a settings file holding a JSON array is refused instead of being overwritten", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "claude-settings-"));
  const target = path.join(dir, "settings.json");
  writeFileSync(target, "[1,2,3]");
  assert.throws(() => readClaudeSettings(target), /does not contain a JSON object/);
});

test("CLAUDE_CONFIG_DIR redirects the settings path", () => {
  assert.equal(
    claudeSettingsPath({ CLAUDE_CONFIG_DIR: path.join("/custom", "cfg") }),
    path.join("/custom", "cfg", "settings.json"),
  );
});
