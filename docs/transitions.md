# Transitions

Transitions describe how the runtime moves between steps. They're resolved at compile time — the JSON describes intent, the compiler emits concrete node ids.

## Resolution order

For each step, the compiler picks a transition target by walking this list top to bottom:

1. **Per-choice override.** If the step is `multiple_choice_single` and the picked choice has `transitionTo`, use that.
2. **Step `next`.** Otherwise, use the step's `next` field.
3. **Default.** If `next` is unset, behave as if it were `__continue__`.

Whatever target is selected is then resolved to a concrete node:

| Target | Resolution |
|---|---|
| `__end__` | The flow terminates. |
| `__continue__` | The step whose `order` is `current.order + 1`. If none exists, `__end__`. |
| `SID*` (a section id) | The step in that section with the lowest `order`. If the section is empty, `__continue__` semantics apply. |
| Any other string | Treated as a step `id`. |

## Gapped orders

The resolver looks for `order + 1` exactly, not "the next-largest order". A flow with orders `1, 6, 10` and `next: "__continue__"` on step 1 will resolve to `__end__`, not to step 6.

This is intentional: gapped orders almost always come from an editor that deletes and re-inserts steps without re-numbering — the right answer is to renumber before saving, not to silently traverse a gap.

If you need non-sequential ordering, use explicit `next` targets.

## Conditional branching

Per-choice `transitionTo` is how you fan out. The compiler emits one Pipecat function per choice when at least one choice has a `transitionTo`:

```jsonc
{
  "type": "multiple_choice_single",
  "choices": [
    { "id": "C1", "display": "Yes", "order": 1, "transitionTo": "SID2" },
    { "id": "C2", "display": "No",  "order": 2, "transitionTo": "__end__" }
  ]
}
```

If no choice has `transitionTo`, the step compiles to a single function with the step's `next` target — cheaper for the LLM to reason about.

## Section jumps

Section jumps are common when the flow has a "main path" with optional deep-dives:

```jsonc
{ "id": "Q5", "order": 5, "sectionId": "SID2", "next": "SID3" }
```

Step `Q5` always advances to the first step of section `SID3`, regardless of what comes next by `order`. The runtime doesn't need to know what `SID3` *is* — the compiler resolves it to the concrete step id.

## End targets

`__end__` is special. The compiler emits an `__end__` node with the closing message and `post_actions` that tell the runtime to wrap up the session. Don't define a step with id `__end__`.

## Start

There is no explicit start step in the schema. The compiler synthesises a `start` node that runs the `metadata.customStartMessage` (or a default) and transitions to the lowest-`order` step.
