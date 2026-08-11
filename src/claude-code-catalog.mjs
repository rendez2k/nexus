// Shapes the router's model list for Claude Code's gateway model discovery.
//
// Claude Code queries GET /v1/models?limit=1000 at startup when
// CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1 is set and adds what it gets
// back to the /model picker. That response is not the OpenAI list the Codex
// path serves: it reads `id` and an optional `display_name` from a `data`
// array, and it filters the entries before showing them.

export const DISCOVERY_NAMESPACE = "anthropic-router";

// Claude Code keeps a discovered entry only when its id contains "claude" or
// "anthropic" anywhere in the string, case-insensitively, and ignores the rest
// without reporting it. A routed slug like "kimi-oauth/kimi-k3" therefore never
// reaches the picker at all. Namespacing those slugs is what makes them
// visible; provider-prefixed ids are explicitly supported by the filter.
const DISCOVERY_FILTER = /claude|anthropic/i;

export function passesDiscoveryFilter(id) {
  return typeof id === "string" && DISCOVERY_FILTER.test(id);
}

// A slug that already carries either substring is published unchanged. Renaming
// it would create a second picker row for a model Claude Code can already fold
// into its built-in entry, and would break the id across router updates.
export function discoveryModelId(slug) {
  const value = String(slug || "").trim();
  if (!value) throw new Error("A model slug is required.");
  if (value.startsWith(`${DISCOVERY_NAMESPACE}/`)) {
    throw new Error(`A model slug may not start with the reserved "${DISCOVERY_NAMESPACE}/" namespace.`);
  }
  return passesDiscoveryFilter(value) ? value : `${DISCOVERY_NAMESPACE}/${value}`;
}

// The inverse of discoveryModelId. Claude Code sends the discovered id back as
// the `model` field on /v1/messages, so the inbound handler has to recover the
// registry slug before it can pick a provider.
export function slugFromDiscoveryId(id) {
  const value = String(id || "").trim();
  if (!value) return undefined;
  const prefix = `${DISCOVERY_NAMESPACE}/`;
  return value.startsWith(prefix) ? value.slice(prefix.length) || undefined : value;
}

// `hidden` is the same per-model visibility state the Codex picker uses, so a
// model switched off in the tray disappears from both targets rather than only
// the one whose surface the switch was drawn on.
export function buildDiscoveryCatalog(models, hidden = new Set()) {
  const data = [];
  const seen = new Set();
  for (const model of models || []) {
    if (!model?.listed) continue;
    if (hidden.has(model.slug)) continue;
    const id = discoveryModelId(model.slug);
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = { id };
    if (model.displayName) entry.display_name = model.displayName;
    data.push(entry);
  }
  return { data };
}
