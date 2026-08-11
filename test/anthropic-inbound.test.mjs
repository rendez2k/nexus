import assert from "node:assert/strict";
import test from "node:test";

import {
  anthropicErrorBody,
  inboundForwardHeaders,
  isStreamingRequest,
  resolveInboundModel,
  rewriteInboundBody,
  shouldRelayUpstreamBodyVerbatim,
} from "../src/anthropic-inbound.mjs";
import { DISCOVERY_NAMESPACE } from "../src/claude-code-catalog.mjs";

const REGISTRY = new Map([
  ["kimi-oauth/kimi-k3", { slug: "kimi-oauth/kimi-k3", gatewayModel: "kimi-oauth-kimi-k3" }],
  [
    "anthropic-api/claude-opus-4.8",
    { slug: "anthropic-api/claude-opus-4.8", gatewayModel: "anthropic-api-claude-opus-4-8" },
  ],
]);

test("a namespaced discovery id resolves to its gateway model", () => {
  const resolved = resolveInboundModel(`${DISCOVERY_NAMESPACE}/kimi-oauth/kimi-k3`, REGISTRY);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.slug, "kimi-oauth/kimi-k3");
  assert.equal(resolved.gatewayModel, "kimi-oauth-kimi-k3");
});

test("an un-namespaced id still resolves, since the filter left it alone", () => {
  const resolved = resolveInboundModel("anthropic-api/claude-opus-4.8", REGISTRY);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.gatewayModel, "anthropic-api-claude-opus-4-8");
});

test("an unknown model is refused with an Anthropic-shaped error naming the id", () => {
  const resolved = resolveInboundModel("anthropic-router/vendor/retired", REGISTRY);
  assert.equal(resolved.ok, false);
  assert.equal(resolved.status, 404);
  assert.equal(resolved.body.type, "error");
  assert.equal(resolved.body.error.type, "not_found_error");
  assert.match(resolved.body.error.message, /anthropic-router\/vendor\/retired/);
});

test("a missing model is a 400 rather than a 404", () => {
  for (const value of [undefined, "", "   "]) {
    const resolved = resolveInboundModel(value, REGISTRY);
    assert.equal(resolved.ok, false);
    assert.equal(resolved.status, 400);
    assert.equal(resolved.body.error.type, "invalid_request_error");
  }
});

test("only the model field is rewritten", () => {
  const payload = {
    model: `${DISCOVERY_NAMESPACE}/kimi-oauth/kimi-k3`,
    max_tokens: 1024,
    stream: true,
    thinking: { type: "adaptive" },
    tools: [{ name: "Read", input_schema: { type: "object" }, strict: true }],
    system: [{ type: "text", text: "attribution" }],
  };

  const rewritten = rewriteInboundBody(payload, "kimi-oauth-kimi-k3");

  assert.equal(rewritten.model, "kimi-oauth-kimi-k3");
  // The contract is explicit that reshaping a body breaks the pairing between
  // a beta header and the field it travels with, so everything else is byte
  // identical, including fields this router has never heard of.
  assert.deepEqual(rewritten.thinking, payload.thinking);
  assert.deepEqual(rewritten.tools, payload.tools);
  assert.deepEqual(rewritten.system, payload.system);
  assert.equal(rewritten.max_tokens, 1024);
  assert.equal(rewritten.stream, true);
});

test("rewriting does not mutate the caller's payload", () => {
  const payload = { model: "anthropic-api/claude-opus-4.8", max_tokens: 8 };
  rewriteInboundBody(payload, "swapped");
  assert.equal(payload.model, "anthropic-api/claude-opus-4.8");
});

test("anthropic-version and anthropic-beta reach the gateway untouched", () => {
  const forwarded = inboundForwardHeaders(
    {
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "context-management-2025-06-27,interleaved-thinking-2025-05-14",
      "x-claude-code-session-id": "sess_123",
      "content-type": "application/json",
    },
    "internal-key",
  );

  assert.equal(forwarded["anthropic-version"], "2023-06-01");
  assert.equal(
    forwarded["anthropic-beta"],
    "context-management-2025-06-27,interleaved-thinking-2025-05-14",
  );
  assert.equal(forwarded["x-claude-code-session-id"], "sess_123");
});

test("an unrecognized anthropic-beta value is forwarded rather than filtered", () => {
  // Capabilities arrive as new beta values in later Claude Code releases; a
  // gateway pinned to today's list breaks on the release that adds one.
  const forwarded = inboundForwardHeaders(
    { "anthropic-beta": "some-capability-not-invented-yet-2099-01-01" },
    "internal-key",
  );
  assert.equal(forwarded["anthropic-beta"], "some-capability-not-invented-yet-2099-01-01");
});

test("the caller's credential never travels to the gateway", () => {
  const forwarded = inboundForwardHeaders(
    {
      authorization: "Bearer caller-secret",
      "x-api-key": "caller-secret",
      host: "127.0.0.1:4102",
      "content-length": "42",
    },
    "internal-key",
  );

  assert.equal(forwarded.authorization, "Bearer internal-key");
  assert.equal("x-api-key" in forwarded, false);
  assert.equal("host" in forwarded, false);
  // A stale length would describe the pre-rewrite body, not the one sent.
  assert.equal("content-length" in forwarded, false);
});

test("the gateway hop is uncompressed so SSE pings are not buffered away", () => {
  const forwarded = inboundForwardHeaders({ "accept-encoding": "gzip, br" }, "internal-key");
  assert.equal(forwarded["accept-encoding"], "identity");
});

test("array-valued headers collapse to a single comma-joined value", () => {
  const forwarded = inboundForwardHeaders({ "anthropic-beta": ["a", "b"] }, "internal-key");
  assert.equal(forwarded["anthropic-beta"], "a, b");
});

test("upstream failures are relayed verbatim so Claude Code's retry can match them", () => {
  assert.equal(shouldRelayUpstreamBodyVerbatim(400), true);
  assert.equal(shouldRelayUpstreamBodyVerbatim(429), true);
  assert.equal(shouldRelayUpstreamBodyVerbatim(200), false);
});

test("error bodies use Anthropic's envelope", () => {
  assert.deepEqual(anthropicErrorBody("overloaded_error", "busy"), {
    type: "error",
    error: { type: "overloaded_error", message: "busy" },
  });
});

test("streaming is detected only from an explicit true", () => {
  assert.equal(isStreamingRequest({ stream: true }), true);
  assert.equal(isStreamingRequest({ stream: false }), false);
  assert.equal(isStreamingRequest({}), false);
});
