// Inbound Anthropic Messages surface, for Claude Code.
//
// Codex talks to this router in the Responses API. Claude Code talks Anthropic
// Messages, and expects a gateway to behave like api.anthropic.com. Rather than
// hand-translating Messages into each provider's dialect, this forwards to the
// LiteLLM gateway's own /v1/messages endpoint, which already owns the
// translation for every model in the routing config.
//
// The rules encoded here come from Claude Code's gateway protocol contract:
// pass anthropic-version and anthropic-beta through untouched, never reshape a
// request or error body, and never buffer a stream.

import { slugFromDiscoveryId } from "./claude-code-catalog.mjs";

// Claude Code gains capabilities as new anthropic-beta values and new body
// fields, and the contract is explicit that a gateway pinned to the values it
// sees today breaks the next release. So this is a denylist of headers that
// must not cross the boundary, not an allowlist of the ones understood.
const DROPPED_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  "authorization",
  "x-api-key",
  "transfer-encoding",
  "keep-alive",
  "upgrade",
  "proxy-authorization",
  "te",
  "trailer",
]);

export function anthropicErrorBody(type, message) {
  return { type: "error", error: { type, message } };
}

// Claude Code sends back the id it discovered, so an enabled model arrives as
// its namespaced form and has to be mapped to the gateway name LiteLLM knows.
export function resolveInboundModel(requested, modelBySlug) {
  const value = String(requested || "").trim();
  if (!value) {
    return { ok: false, status: 400, body: anthropicErrorBody("invalid_request_error", "A model is required.") };
  }
  const slug = slugFromDiscoveryId(value);
  const model = slug ? modelBySlug.get(slug) : undefined;
  if (!model) {
    // Named rather than generic: an unknown model here almost always means the
    // picker holds an entry from a catalog the router has since changed, and
    // saying which id failed is what makes that diagnosable.
    return {
      ok: false,
      status: 404,
      body: anthropicErrorBody("not_found_error", `This router does not serve the model "${value}".`),
    };
  }
  return { ok: true, slug: model.slug, gatewayModel: model.gatewayModel, model };
}

// Only the model field is rewritten. The contract warns that a gateway which
// rewrites or redacts request bodies breaks the pairing between a beta header
// and the body field it travels with, producing hard 400s.
export function rewriteInboundBody(payload, gatewayModel) {
  return { ...payload, model: gatewayModel };
}

export function inboundForwardHeaders(headers, internalKey) {
  const forwarded = {};
  for (const [name, value] of Object.entries(headers || {})) {
    const key = name.toLowerCase();
    if (DROPPED_REQUEST_HEADERS.has(key)) continue;
    if (value === undefined) continue;
    forwarded[key] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  forwarded["content-type"] = "application/json";
  // The caller's credential authenticated it at this router's edge; the gateway
  // behind it has its own internal key, and the caller's never travels onward.
  forwarded.authorization = `Bearer ${internalKey}`;
  // The byte watchdog counts everything relayed, including SSE pings, so the
  // stream must not be compressed into a buffer on the way through.
  forwarded["accept-encoding"] = "identity";
  return forwarded;
}

// Claude Code's automatic retry matches on the upstream's error wording and
// disables the rejected capability for the rest of the conversation. Wrapping
// an upstream error in this router's own envelope silently breaks that
// recovery, so a forwarded failure keeps its body byte-for-byte.
export function shouldRelayUpstreamBodyVerbatim(status) {
  return typeof status === "number" && status >= 400;
}

export function isStreamingRequest(payload) {
  return payload?.stream === true;
}
