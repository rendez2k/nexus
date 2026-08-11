import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVERY_NAMESPACE,
  buildDiscoveryCatalog,
  discoveryModelId,
  passesDiscoveryFilter,
  slugFromDiscoveryId,
} from "../src/claude-code-catalog.mjs";

test("slugs Claude Code would drop are namespaced into the picker", () => {
  // Without the namespace these ids fail Claude Code's filter and vanish from
  // /model with no error, which is the whole reason the mapping exists.
  assert.equal(passesDiscoveryFilter("kimi-oauth/kimi-k3"), false);
  assert.equal(discoveryModelId("kimi-oauth/kimi-k3"), `${DISCOVERY_NAMESPACE}/kimi-oauth/kimi-k3`);
  assert.equal(passesDiscoveryFilter(discoveryModelId("kimi-oauth/kimi-k3")), true);
});

test("slugs that already satisfy the filter are published unchanged", () => {
  assert.equal(discoveryModelId("anthropic-api/claude-opus-4.8"), "anthropic-api/claude-opus-4.8");
  assert.equal(
    discoveryModelId("commandcode-messages/claude-sonnet-5"),
    "commandcode-messages/claude-sonnet-5",
  );
});

test("the filter matches case-insensitively anywhere in the id", () => {
  assert.equal(passesDiscoveryFilter("vendor/Claude-Next"), true);
  assert.equal(passesDiscoveryFilter("ANTHROPIC-mirror/x"), true);
  assert.equal(passesDiscoveryFilter("deepseek/deepseek-v4-pro"), false);
});

test("discovery ids round-trip back to their registry slug", () => {
  for (const slug of [
    "kimi-oauth/kimi-k3",
    "anthropic-api/claude-opus-4.8",
    "deepseek/deepseek-v4-pro",
    "commandcode/grok-4.5",
  ]) {
    assert.equal(slugFromDiscoveryId(discoveryModelId(slug)), slug, `round trip failed for ${slug}`);
  }
});

test("a slug in the reserved namespace is rejected rather than silently collapsed", () => {
  // Round-tripping such a slug would strip a segment the registry owns, so it
  // has to fail loudly at publish time instead of routing to the wrong model.
  assert.throws(
    () => discoveryModelId(`${DISCOVERY_NAMESPACE}/kimi-oauth/kimi-k3`),
    /reserved/,
  );
});

test("the catalog carries display names and drops unlisted models", () => {
  const catalog = buildDiscoveryCatalog([
    { slug: "kimi-oauth/kimi-k3", displayName: "Kimi K3", listed: true },
    { slug: "anthropic-api/claude-opus-4.8", displayName: "Claude Opus 4.8 (API)", listed: true },
    { slug: "vendor/compat-alias", displayName: "Alias", listed: false },
  ]);

  assert.deepEqual(catalog, {
    data: [
      { id: `${DISCOVERY_NAMESPACE}/kimi-oauth/kimi-k3`, display_name: "Kimi K3" },
      { id: "anthropic-api/claude-opus-4.8", display_name: "Claude Opus 4.8 (API)" },
    ],
  });
});

test("models hidden in the tray are withheld from Claude Code too", () => {
  const models = [
    { slug: "kimi-oauth/kimi-k3", displayName: "Kimi K3", listed: true },
    { slug: "deepseek/deepseek-v4-pro", displayName: "DeepSeek V4 Pro", listed: true },
  ];
  const catalog = buildDiscoveryCatalog(models, new Set(["kimi-oauth/kimi-k3"]));

  assert.deepEqual(catalog.data, [
    { id: `${DISCOVERY_NAMESPACE}/deepseek/deepseek-v4-pro`, display_name: "DeepSeek V4 Pro" },
  ]);
});

test("an entry without a display name omits the field rather than sending an empty one", () => {
  const catalog = buildDiscoveryCatalog([{ slug: "anthropic-api/claude-opus-4.8", listed: true }]);
  assert.deepEqual(catalog.data, [{ id: "anthropic-api/claude-opus-4.8" }]);
});
