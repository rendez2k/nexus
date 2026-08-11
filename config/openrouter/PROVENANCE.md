# OpenRouter model provenance

Where each field in this directory's model files came from, per `AGENTS.md`'s
requirement that shipped fields be confirmed rather than inferred.

## Source

`https://openrouter.ai/api/v1/models`, queried 2026-08-11 from a machine with
an active OpenRouter account. The endpoint is public and needs no key.

## Confirmed directly from that response

| Model file | `upstreamModel` | `contextWindow` |
| --- | --- | --- |
| `grok-4.5.json` | `x-ai/grok-4.5` | 500,000 |
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
- `priority` 65-70, from the free range between the existing OpenRouter block
  (63-64) and 100. Every value ranks below its direct counterpart, which
  `registry.test.mjs` asserts.
- `requestProfile` is `auto-tool-choice` throughout. OpenRouter exposes one
  OpenAI-shaped surface, so a native profile such as `xai-reasoning` or
  `qwen-plan` would send parameters that surface does not accept.

## Carried over, not independently confirmed

- `reasoningLevels` mirrors each model's direct configuration, on the basis
  that the effort ladder is a property of the model and OpenRouter passes
  `reasoning_effort` through. This is the one field here not verified against
  OpenRouter itself. Confirm with `bin/test-model` before relying on the
  non-default rungs.

## Deliberately conservative

- `inputModalities` is `["text"]` for all six. The query that produced this
  table did not return per-model image support, and claiming vision that is not
  there breaks routing. Text-only models still read images through the vision
  bridge, so nothing is lost.
- `multiAgentVersion` is left unset, keeping v1 behaviour, since native v2
  collaboration is unproven on these routes.
