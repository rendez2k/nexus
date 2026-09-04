import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  anthropicBasePath,
  anthropicBaseUrl,
  authenticatedRoute,
  callerBasePath,
  redactCallerUrl,
} from "../src/caller-auth.mjs";

const SECRET = "a".repeat(32);
const ANTHROPIC_PREFIX = "/anthropic";

// Mirrors what the router does after authenticating: strip the /anthropic
// segment and dispatch on what is left.
function routeFor(url) {
  const pathname = new URL(url).pathname;
  const route = authenticatedRoute(pathname, SECRET);
  if (!route) return { authenticated: false };
  if (route !== ANTHROPIC_PREFIX && !route.startsWith(`${ANTHROPIC_PREFIX}/`)) {
    return { authenticated: true, anthropic: false, route };
  }
  return {
    authenticated: true,
    anthropic: true,
    route: route.slice(ANTHROPIC_PREFIX.length) || "/",
  };
}

test("the Claude Code base URL stops short of /v1 so the client can append its own", () => {
  // Claude Code posts to `${ANTHROPIC_BASE_URL}/v1/messages`. A base that
  // already ended in /v1 would produce /v1/v1/messages and 404 every turn.
  assert.equal(anthropicBasePath(SECRET), `/_codex-router/${SECRET}/anthropic`);
  assert.equal(callerBasePath(SECRET).endsWith("/v1"), true);
  assert.equal(anthropicBasePath(SECRET).endsWith("/v1"), false);
});

test("the endpoints Claude Code calls land on the routes the router serves", () => {
  const base = anthropicBaseUrl(4102, SECRET);
  for (const [suffix, expected] of [
    ["/v1/messages", "/v1/messages"],
    ["/v1/messages/count_tokens", "/v1/messages/count_tokens"],
    ["/v1/models?limit=1000", "/v1/models"],
    ["/api/hello", "/api/hello"],
  ]) {
    const result = routeFor(`${base}${suffix}`);
    assert.equal(result.authenticated, true, `${suffix} failed to authenticate`);
    assert.equal(result.anthropic, true, `${suffix} did not reach the Anthropic surface`);
    assert.equal(result.route, expected);
  }
});

test("the Codex surface is untouched by the Anthropic prefix", () => {
  // Both clients call /v1/models and expect different shapes, so the Codex
  // route must not be reachable through the Anthropic branch or vice versa.
  const codex = routeFor(`http://127.0.0.1:4102/_codex-router/${SECRET}/v1/models`);
  assert.equal(codex.authenticated, true);
  assert.equal(codex.anthropic, false);
  assert.equal(codex.route, "/v1/models");
});

test("a wrong or missing caller secret never reaches the Anthropic surface", () => {
  const wrong = "b".repeat(32);
  assert.equal(
    routeFor(`http://127.0.0.1:4102/_codex-router/${wrong}/anthropic/v1/messages`).authenticated,
    false,
  );
  assert.equal(
    routeFor("http://127.0.0.1:4102/anthropic/v1/messages").authenticated,
    false,
  );
});

test("a path that merely starts with the prefix string is not treated as the prefix", () => {
  // "/anthropic-api/..." shares a prefix with "/anthropic" as a raw string.
  // Matching on the segment boundary is what keeps it on the Codex surface.
  const result = routeFor(`http://127.0.0.1:4102/_codex-router/${SECRET}/anthropic-api/v1/models`);
  assert.equal(result.authenticated, true);
  assert.equal(result.anthropic, false);
});

test("the caller secret is redacted out of a Claude Code base URL before it is printed", () => {
  const redacted = redactCallerUrl(anthropicBaseUrl(4102, SECRET));
  assert.equal(redacted.includes(SECRET), false);
  assert.match(redacted, /\[REDACTED\]/);
});

// The unit tests above all passed while router.mjs had no idea this route
// existed: an upstream sync replaced the file, anthropic-inbound.mjs was left
// imported by nothing, and Claude Code would have got a 404 from a green suite.
// These assert the wiring itself, which is the part a module test cannot see.
test("the router actually serves the Anthropic base path", () => {
  const source = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "router.mjs"),
    "utf8",
  );
  assert.match(source, /from "\.\/anthropic-inbound\.mjs"/);
  assert.match(source, /const ANTHROPIC_PREFIX = "\/anthropic"/);
  // Recognising the prefix is not enough; it has to reach the handler.
  assert.match(source, /startsWith\(`\$\{ANTHROPIC_PREFIX\}\/`\)/);
  assert.match(source, /await handleAnthropicRequest\(/);
});
