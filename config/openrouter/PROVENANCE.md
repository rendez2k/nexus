# OpenRouter model provenance

Where each field in this directory's model files came from, per `AGENTS.md`'s
requirement that shipped fields be confirmed rather than inferred.

## Source

`https://openrouter.ai/api/v1/models`, queried 2026-08-11 from a machine with
an active OpenRouter account. The endpoint is public and needs no key.

## Confirmed directly from that response

| Model file | `upstreamModel` | `contextWindow` |
| --- | --- | --- |
| `grok-4.20.json` | `x-ai/grok-4.20` | 2,000,000 |
| `grok-4.20-multi-agent.json` | `x-ai/grok-4.20-multi-agent` | 2,000,000 |
| `grok-4.3.json` | `x-ai/grok-4.3` | 1,000,000 |
| `grok-4.5.json` | `x-ai/grok-4.5` | 500,000 |
| `grok-4.6.json` | `x-ai/grok-4.6` | 500,000 |
| `grok-build-0.1.json` | `x-ai/grok-build-0.1` | 256,000 |
| `muse-spark-1.1.json` | `meta/muse-spark-1.1` | 1,048,576 |
| `muse-spark-1.2.json` | `meta/muse-spark-1.2` | 1,048,576 |
| `qwen3.7-max.json` | `qwen/qwen3.7-max` | 1,000,000 |
| `qwen3.7-plus.json` | `qwen/qwen3.7-plus` | 1,000,000 |
| `qwen3.8-max.json` | `qwen/qwen3.8-max` | 1,000,000 |

Note that OpenRouter's windows differ from the direct providers' for the same
models — `qwen-plan/qwen3.8-max` is 262,144 direct against 1,000,000 here, and
`meta/muse-spark-1.1` is 1,000,000 direct against 1,048,576 here. The values
above are the ones that apply on this route.

## Derived from existing repository conventions

- `autoCompact` reuses the ratio this repository already applies at each window
  size: 900,000 at 1,048,576 (as `openrouter/deepseek-v4-pro`), 850,000 at
  1,000,000 (as `meta/muse-spark-1.1`), 440,000 at 500,000 (as
  `grok-api/grok-4.5`).
- `priority` 65-75, from the free range between the existing OpenRouter block
  (63-64) and 100. Every value ranks below its direct counterpart, which
  `registry.test.mjs` asserts. Within the Grok family the newest model ranks
  highest: 4.6 took 65 and 4.5 moved to 75, since 4.6 supersedes it at the same
  500k window.
- `requestProfile` is `auto-tool-choice` throughout. OpenRouter exposes one
  OpenAI-shaped surface, so a native profile such as `xai-reasoning` or
  `qwen-plan` would send parameters that surface does not accept.

## Carried over, not independently confirmed

- `reasoningLevels` mirrors each model's direct configuration, on the basis
  that the effort ladder is a property of the model and OpenRouter passes
  `reasoning_effort` through. This is the one field here not verified against
  OpenRouter itself. Confirm with `bin/test-model` before relying on the
  non-default rungs.

## Not shipped, and why

- `~x-ai/grok-latest` appears in the same response with a leading tilde, which
  is not a plain model id. Whatever that prefix denotes on OpenRouter is
  unconfirmed, and a floating "latest" alias would in any case change model
  under a fixed slug without the catalog noticing.
- `meta/muse-glimmer-30b` is a different model rather than a route to one this
  repository already ships, so it belongs in a curation pass, not here.

OpenRouter labels the Grok entries "SpaceXAI" while the direct provider is
`grok-api` / xAI. The ids are what route, so the vendor label is noted rather
than followed; display names stay "Grok N (OpenRouter)" for consistency with
the rest of the picker.

## Deliberately conservative

- `inputModalities` is `["text"]` for all six. The query that produced this
  table did not return per-model image support, and claiming vision that is not
  there breaks routing. Text-only models still read images through the vision
  bridge, so nothing is lost.
- `multiAgentVersion` is left unset, keeping v1 behaviour, since native v2
  collaboration is unproven on these routes.
