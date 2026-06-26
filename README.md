# voice-flow-schema

> Portable JSON schema for voice AI conversation flows. Define a flow once, compile it to Pipecat RTVI (and other voice frameworks).

[![CI](https://github.com/ear3-ai/voice-flow-schema/actions/workflows/ci.yml/badge.svg)](https://github.com/ear3-ai/voice-flow-schema/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ear3/voice-flow-schema.svg)](https://www.npmjs.com/package/@ear3/voice-flow-schema)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

## Why?

Today, defining a multi-step voice agent on [Pipecat](https://github.com/pipecat-ai/pipecat) (or any other framework) means hand-writing a graph of nodes, prompts, and function-calling transitions in Python or JavaScript. It works, but:

- The flow lives in code, so it can't be edited by non-developers, versioned as data, or shared between products.
- Switching frameworks means rewriting from scratch.
- There's no shared way to import flows from existing tooling (Qualtrics, Google Forms, SurveyJS).

**`voice-flow-schema` is a JSON format for voice conversation flows**, plus a compiler that emits the Pipecat-flavored graph the runtime actually wants.

You author a small declarative file:

```jsonc
{
  "version": "2.0",
  "metadata": { "preamble": "You are a friendly researcher.", "language": "en" },
  "steps": [
    { "id": "Q1", "type": "voice_input_single", "text": "What brings you here?", "order": 1, "required": true },
    { "id": "Q2", "type": "multiple_choice_single", "text": "How urgent is this?", "order": 2, "required": true,
      "choices": [
        { "id": "C1", "display": "Right now", "order": 1, "transitionTo": "__end__" },
        { "id": "C2", "display": "Sometime this week", "order": 2 }
      ] }
  ]
}
```

…and the package turns it into a Pipecat RTVI flow you can drop straight into [`pipecat-flows`](https://github.com/pipecat-ai/pipecat-flows).

## Install

```bash
npm install @ear3/voice-flow-schema
```

Peer requirement: Node 18+.

## Quick start

```ts
import {
  parseConversationFlow,
  toPipecatRtvi,
  generateHandlers,
} from '@ear3/voice-flow-schema'

import flowJson from './my-flow.json' assert { type: 'json' }

// 1. Validate at the boundary (throws ZodError on bad input).
const flow = parseConversationFlow(flowJson)

// 2. Compile to a Pipecat RTVI graph.
const pipecatFlow = toPipecatRtvi(flow)

// 3. Generate matching JS handler stubs (optional — for dynamic flows).
const handlers = generateHandlers(flow)
```

Hand `pipecatFlow` to your Pipecat server. Hand `handlers` to whatever JS runtime executes per-node logic (e.g. QuickJS inside `pipecat-flows`).

## What's in the schema

Top-level shape:

```ts
type ConversationFlow = {
  version: '2.0'
  steps: FlowStep[]
  metadata: FlowMetadata
}
```

A **step** is one of:

| `type` | Meaning |
|---|---|
| `voice_input_single` | Short free-text answer. |
| `voice_input_multiline` | Longer free-text answer. |
| `multiple_choice_single` | Pick one from `choices`. |
| `multiple_choice_multiple` | Pick zero or more from `choices`. |
| `likert_scale` | Ordinal scale with labeled endpoints. |
| `rating_scale` | Numeric rating. |
| `display_list` | Present items to the user; no answer collected. |

A **transition** points to the next step:

- `"__continue__"` — next step by `order` (default if `next` is omitted).
- `"__end__"` — finish the flow.
- `"SID*"` — jump to the first step in that section.
- A choice can override the step's default `next` via `transitionTo` — this is how you branch.

See [`docs/spec.md`](./docs/spec.md) for the full reference and [`docs/transitions.md`](./docs/transitions.md) for transition resolution rules.

## Examples

The [`examples/`](./examples) folder has five complete flows you can copy:

1. [`01-simple-interview.json`](./examples/01-simple-interview.json) — linear interview, three open questions.
2. [`02-multi-section.json`](./examples/02-multi-section.json) — three sections, explicit section jumps.
3. [`03-branching.json`](./examples/03-branching.json) — conditional branching from a multiple-choice answer.
4. [`04-likert-scale.json`](./examples/04-likert-scale.json) — NPS and rating scales.
5. [`05-with-overlay.json`](./examples/05-with-overlay.json) — `display_list` step attached as an on-screen overlay.

## JSON Schema

A standalone [JSON Schema](./schema/voice-flow.schema.json) is published for editor autocomplete and language-agnostic validation. Add to your JSON file:

```jsonc
{
  "$schema": "https://unpkg.com/@ear3/voice-flow-schema/schema/voice-flow.schema.json",
  "version": "2.0",
  ...
}
```

## Compatibility

- **Pipecat**: emits the graph shape consumed by [`pipecat-flows`](https://github.com/pipecat-ai/pipecat-flows). Tested against `pipecat-ai>=0.0.81`.
- **RTVI**: handler stubs are framework-agnostic JS source strings, suitable for QuickJS or a Node sandbox.

Adapters for **Qualtrics QSF**, **Google Forms**, and **SurveyJS** are planned for v0.2.

## Status

**v0.1** — schema is frozen, the Pipecat RTVI compiler is production-tested inside [Ear3](https://ear3.ai). Roadmap:

- [ ] v0.2: importers for Qualtrics QSF / Google Forms / SurveyJS.
- [ ] v0.3: exporter back to QSF for round-tripping.
- [ ] v0.4: a Python port of the compiler so Pipecat-Python projects can consume the schema natively.

## Contributing

Issues and PRs welcome. To work on the package locally:

```bash
git clone https://github.com/ear3-ai/voice-flow-schema.git
cd voice-flow-schema
npm install
npm test
npm run build
```

## License

[MIT](./LICENSE) © Ear3.
