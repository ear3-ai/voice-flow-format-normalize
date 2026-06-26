# voice-flow-schema specification

Version: **2.0**

A `ConversationFlow` is a JSON document describing a multi-step voice agent. It is intentionally small: nine top-level types, no execution semantics of its own. The compiler is responsible for mapping the document to a target runtime (Pipecat RTVI today, others later).

---

## `ConversationFlow`

```ts
{
  version: "2.0",
  steps: FlowStep[],          // at least one
  metadata: FlowMetadata
}
```

### Invariants

- `steps[].id` is unique.
- `steps[].order` is unique and positive.
- Every `steps[].sectionId` that is set must match a `metadata.sections[].id`.
- Transitions to step ids reference an existing step; transitions to section ids reference an existing section.

---

## `FlowStep`

```ts
{
  id: string,                 // stable identifier (e.g. "Q1")
  type: StepType,
  text: string,               // prompt
  required: boolean,
  order: number,              // 1-based
  sectionId?: string,         // optional grouping (SID*)
  next?: Transition,          // default next step
  choices?: Choice[],         // for choice / display types
  validation?: TextValidation,// for voice_input_* types
  scale?: Scale,              // for likert_scale / rating_scale
  attachedOverlayId?: string, // attach a display_list step as overlay
  overlayImageUrl?: string    // image for display_list type
}
```

### `StepType`

| Value | Used with |
|---|---|
| `voice_input_single` | `validation` |
| `voice_input_multiline` | `validation` |
| `multiple_choice_single` | `choices` (+ per-choice `transitionTo`) |
| `multiple_choice_multiple` | `choices` |
| `likert_scale` | `scale` |
| `rating_scale` | `scale` |
| `display_list` | `choices` (as list items), `overlayImageUrl` |

---

## `Choice`

```ts
{
  id: string,
  display: string,            // shown / spoken to the user
  value?: string,             // stored value; defaults to `display`
  order: number,
  transitionTo?: Transition   // overrides the step's `next` when this choice is picked
}
```

---

## `Transition`

A string. Reserved tokens:

| Token | Meaning |
|---|---|
| `__continue__` | Next step by `order` (default if `next` is omitted). |
| `__end__` | Terminate the flow. |
| `SID*` | First step in that section, by `order`. |

Any other string is treated as a step `id` (back-compat).

See [`transitions.md`](./transitions.md) for resolution rules and edge cases.

---

## `TextValidation`

```ts
{
  minLength?: number,
  maxLength?: number,
  pattern?: string            // regex source, no flags
}
```

Validation hints are passed through to the runtime as function-parameter constraints; enforcement depends on the runtime / model.

---

## `Scale`

```ts
{
  min: number,                // integer
  max: number,                // integer, > min
  minLabel?: string,
  maxLabel?: string
}
```

---

## `FlowSection`

```ts
{
  id: string,                 // conventionally "SID1", "SID2", …
  name: string,
  description?: string,
  order: number
}
```

Sections are addressable transition targets and inform runtime logging / overlays. They do not gate progression on their own — a flow without sections is valid.

---

## `FlowMetadata`

```ts
{
  preamble: string,           // top-level system prompt
  language: string,           // BCP-47-ish (e.g. "en", "uk")
  name?: string,
  description?: string,
  customStartMessage?: string,
  customEndMessage?: string,
  sections?: FlowSection[],
  voiceId?: string,           // provider-specific TTS voice
  vadParams?: { stop_secs?: number },
  maxSessionDuration?: number,// seconds
  conversationSpeed?: 'slow' | 'normal' | 'fast'
}
```

---

## Versioning

`version` is a literal string. Breaking changes bump it; non-breaking changes (new optional fields) do not.

The Zod and TypeScript definitions ship together — the JSON Schema in `schema/voice-flow.schema.json` is generated from Zod, so the three never drift.
