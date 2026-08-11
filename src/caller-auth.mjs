import { timingSafeEqual } from "node:crypto";

export const CALLER_PATH_PREFIX = "/_codex-router";
const MINIMUM_SECRET_LENGTH = 32;
const SECRET_PATTERN = /^[A-Za-z0-9_-]+$/;

export function validCallerSecret(value) {
  return (
    typeof value === "string" &&
    value.length >= MINIMUM_SECRET_LENGTH &&
    SECRET_PATTERN.test(value)
  );
}

export function assertCallerSecret(value) {
  if (!validCallerSecret(value)) {
    throw new Error("The local router caller key is missing or invalid; run ./bin/doctor --fix.");
  }
  return value;
}

export function secretEqual(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function callerBasePath(secret) {
  return `${CALLER_PATH_PREFIX}/${assertCallerSecret(secret)}/v1`;
}

export function callerBaseUrl(port, secret) {
  return `http://127.0.0.1:${port}${callerBasePath(secret)}`;
}

// Claude Code appends its own `/v1/...` to whatever ANTHROPIC_BASE_URL holds,
// so this base deliberately stops short of the `/v1` the Codex base carries.
// The `/anthropic` segment is what keeps the two clients' model lists apart.
export function anthropicBasePath(secret) {
  return `${CALLER_PATH_PREFIX}/${assertCallerSecret(secret)}/anthropic`;
}

export function anthropicBaseUrl(port, secret) {
  return `http://127.0.0.1:${port}${anthropicBasePath(secret)}`;
}

export function authenticatedRoute(pathname, expectedSecret) {
  if (typeof pathname !== "string") return undefined;
  const prefix = `${CALLER_PATH_PREFIX}/`;
  if (!pathname.startsWith(prefix)) return undefined;
  const remainder = pathname.slice(prefix.length);
  const separator = remainder.indexOf("/");
  if (separator === -1) return undefined;
  const candidate = remainder.slice(0, separator);
  if (!secretEqual(candidate, expectedSecret)) return undefined;
  return remainder.slice(separator) || "/";
}

export function isManagedCallerBaseUrl(value, port) {
  if (typeof value !== "string" || !value) return false;
  try {
    const url = new URL(value);
    const expectedPort =
      port === undefined ? undefined : Number(port) === 80 ? "" : String(port);
    if (
      url.protocol !== "http:" ||
      url.hostname !== "127.0.0.1" ||
      (port !== undefined && url.port !== expectedPort) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return false;
    }
    const match = url.pathname.match(
      new RegExp(`^${CALLER_PATH_PREFIX}/([A-Za-z0-9_-]+)/v1/?$`),
    );
    return Boolean(match && validCallerSecret(match[1]));
  } catch {
    return false;
  }
}

// The secret is whatever follows the prefix, so it is redacted on the segment
// boundary rather than on the surface that happens to come after it. Anchoring
// this to `/v1` meant the Claude Code base URL, which ends in `/anthropic`,
// printed its caller key in full.
export function redactCallerUrl(value) {
  if (typeof value !== "string") return value;
  return value.replace(
    new RegExp(`(${CALLER_PATH_PREFIX}/)[A-Za-z0-9_-]+(?=/|$)`, "g"),
    "$1[REDACTED]",
  );
}
