// Claude Code target integration.
//
// Codex learns about routed models by having its native catalog merged on disk.
// Claude Code has no catalog file: it is pointed at a gateway with
// ANTHROPIC_BASE_URL and asked to discover models over HTTP. So "installing"
// this target means writing an env block into Claude Code's settings file and
// nothing else — no catalog capture, no merge, no restore.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { anthropicBaseUrl, assertCallerSecret } from "./caller-auth.mjs";
import { protectPrivateFile } from "./file-security.mjs";
import { CALLER_SECRET_PATH, PORTS } from "./paths.mjs";

// Claude Code reads ~/.claude/settings.json, or the same file under
// CLAUDE_CONFIG_DIR when that is set. The project-scoped settings files are
// deliberately not supported here: they are committed, and this block carries
// the router's caller key.
export function claudeSettingsPath(env = process.env) {
  if (env.CODEX_ROUTER_CLAUDE_SETTINGS) return env.CODEX_ROUTER_CLAUDE_SETTINGS;
  const configDir = env.CLAUDE_CONFIG_DIR;
  return configDir
    ? path.join(configDir, "settings.json")
    : path.join(homedir(), ".claude", "settings.json");
}

// Only these keys are ours. Anything else in the env block belongs to the user
// and has to survive both enable and disable untouched.
export const MANAGED_ENV_KEYS = Object.freeze([
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY",
]);

export function readClaudeSettings(target) {
  if (!existsSync(target)) return {};
  const raw = readFileSync(target, "utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${target} does not contain a JSON object.`);
  }
  return parsed;
}

// Pure so the merge behavior can be tested without a real Claude Code install.
// The whole settings document is carried through by spread rather than rebuilt,
// because anything this function does not know about is still the user's.
export function applyClaudeCodeEnv(settings, { baseUrl, callerKey }) {
  if (!baseUrl) throw new Error("A router base URL is required.");
  if (!callerKey) throw new Error("A router caller key is required.");
  return {
    ...settings,
    env: {
      ...(settings?.env || {}),
      ANTHROPIC_BASE_URL: baseUrl,
      ANTHROPIC_AUTH_TOKEN: callerKey,
      // Without this Claude Code never calls /v1/models, and every routed model
      // is missing from the picker even though the gateway serves it.
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: "1",
    },
  };
}

export function removeClaudeCodeEnv(settings) {
  const env = { ...(settings?.env || {}) };
  for (const key of MANAGED_ENV_KEYS) delete env[key];
  const next = { ...settings };
  // An empty env block is left in place rather than deleted: Claude Code ships
  // `{"env": {}}` in a fresh settings file, so removing it would be a change to
  // the user's file that uninstalling this target never asked for.
  next.env = env;
  return next;
}

export function claudeCodeTargetStatus(settings, { baseUrl } = {}) {
  const env = settings?.env || {};
  const configured = MANAGED_ENV_KEYS.every((key) => Boolean(env[key]));
  return {
    configured,
    discoveryEnabled: env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY === "1",
    // Reported so a stale block left by an earlier install, pointing at a port
    // or caller key the router no longer uses, is visible as such instead of
    // looking healthy.
    baseUrlMatches: baseUrl ? env.ANTHROPIC_BASE_URL === baseUrl : undefined,
  };
}

// The caller key is the router's whole authentication boundary, so it is read
// from the protected state file at the moment it is written and never cached,
// logged, or passed as an argument.
export function routerCredentials() {
  if (!existsSync(CALLER_SECRET_PATH)) {
    throw new Error("The local router caller key is missing; run ./bin/doctor --fix.");
  }
  const callerKey = assertCallerSecret(readFileSync(CALLER_SECRET_PATH, "utf8").trim());
  return { callerKey, baseUrl: anthropicBaseUrl(PORTS.router, callerKey) };
}

export function enableClaudeCodeTarget(env = process.env) {
  const target = claudeSettingsPath(env);
  const { baseUrl, callerKey } = routerCredentials();
  writeClaudeSettings(target, applyClaudeCodeEnv(readClaudeSettings(target), { baseUrl, callerKey }));
  return { path: target, baseUrl, configured: true };
}

export function disableClaudeCodeTarget(env = process.env) {
  const target = claudeSettingsPath(env);
  // A settings file that was never configured is left alone entirely rather
  // than rewritten to an identical value, so disabling an inactive target is
  // not a file modification the user has to explain to their VCS.
  if (!existsSync(target)) return { path: target, configured: false, changed: false };
  const before = readClaudeSettings(target);
  const status = claudeCodeTargetStatus(before);
  const managedPresent = MANAGED_ENV_KEYS.some((key) => key in (before.env || {}));
  if (!status.configured && !managedPresent) {
    return { path: target, configured: false, changed: false };
  }
  writeClaudeSettings(target, removeClaudeCodeEnv(before));
  return { path: target, configured: false, changed: true };
}

export function claudeCodeSnapshot(env = process.env) {
  const target = claudeSettingsPath(env);
  let baseUrl;
  try {
    baseUrl = routerCredentials().baseUrl;
  } catch {
    // Reported as unconfigured rather than thrown: `status` has to stay usable
    // on a machine where the router was never installed.
    baseUrl = undefined;
  }
  const settings = existsSync(target) ? readClaudeSettings(target) : {};
  return { path: target, ...claudeCodeTargetStatus(settings, { baseUrl }) };
}

export function writeClaudeSettings(target, settings) {
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp.${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  protectPrivateFile(temporary);
  renameSync(temporary, target);
  // The block holds the caller key, which is the router's whole authentication
  // boundary, so the file is protected even though Claude Code created it with
  // default permissions.
  protectPrivateFile(target);
  try {
    chmodSync(target, 0o600);
  } catch {
    // Windows enforces this through the ACL that protectPrivateFile applied.
  }
  return target;
}
