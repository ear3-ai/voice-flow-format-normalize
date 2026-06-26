/**
 * Voice Flow Schema — portable definition of a voice AI conversation flow.
 *
 * A `ConversationFlow` is a sequence of `FlowStep`s with optional sections,
 * branching, and metadata. It compiles to runtime formats (e.g. Pipecat RTVI).
 */

export const FLOW_SCHEMA_VERSION = '2.0' as const

/**
 * Top-level conversation flow definition.
 */
export interface ConversationFlow {
  version: typeof FLOW_SCHEMA_VERSION
  steps: FlowStep[]
  metadata: FlowMetadata
}

/**
 * A single step in a conversation flow.
 *
 * Steps are ordered by `order`. Transitions can be linear (`__continue__`),
 * jump to a section (`SID*`), or end the flow (`__end__`). Multiple-choice
 * steps can override transitions per-choice for conditional branching.
 */
export interface FlowStep {
  /** Stable identifier, e.g. `Q1`, `Q2`. */
  id: string
  type: StepType
  /** Prompt text the agent speaks / displays. */
  text: string
  /** Answer options for `multiple_choice_*` and `display_list` types. */
  choices?: Choice[]
  /** Length/pattern constraints for `voice_input_*` types. */
  validation?: TextValidation
  /** Numeric range for `likert_scale` / `rating_scale`. */
  scale?: Scale
  required: boolean
  /** Order in the flow (1-based). */
  order: number
  /** Optional section grouping (e.g. `SID1`). */
  sectionId?: string
  /** Default transition: `__continue__`, a section id, or `__end__`. */
  next?: Transition
  /** Attach a `display_list` step's content as an overlay during this step. */
  attachedOverlayId?: string
  /** Optional image shown alongside a `display_list` step. */
  overlayImageUrl?: string
}

/**
 * Supported step types.
 *
 * - `multiple_choice_single`: pick one answer from `choices`.
 * - `multiple_choice_multiple`: pick zero or more answers from `choices`.
 * - `voice_input_single`: short free-text response.
 * - `voice_input_multiline`: longer free-text response.
 * - `likert_scale`: ordinal scale with labeled endpoints.
 * - `rating_scale`: numeric rating.
 * - `display_list`: present items to the user; no answer collected.
 */
export type StepType =
  | 'multiple_choice_single'
  | 'multiple_choice_multiple'
  | 'voice_input_single'
  | 'voice_input_multiline'
  | 'likert_scale'
  | 'rating_scale'
  | 'display_list'

/**
 * Reserved transition targets, or any section / step id.
 *
 * - `__continue__`: next step by order (or first step in the next section).
 * - `__end__`: terminate the flow.
 * - Any string starting with `SID`: jump to first step of that section.
 * - Any other string: treated as a step id (back-compat).
 */
export type Transition = '__continue__' | '__end__' | (string & {})

/**
 * Answer option for choice-based steps.
 *
 * `transitionTo` lets a specific choice override the step's default `next` —
 * this enables conditional branching ("if user picks A, jump to section X").
 */
export interface Choice {
  id: string
  /** Display text shown to the user. */
  display: string
  /** Stored value; defaults to `display` if omitted. */
  value?: string
  order: number
  /** Optional per-choice transition override. */
  transitionTo?: Transition
}

export interface TextValidation {
  minLength?: number
  maxLength?: number
  /** Regex pattern (string form, no flags). */
  pattern?: string
}

export interface Scale {
  min: number
  max: number
  minLabel?: string
  maxLabel?: string
}

/**
 * Optional named grouping of steps.
 *
 * Sections are addressable by id (e.g. `next: "SID2"`) and inform runtime
 * logging / overlays. They do not gate progression on their own.
 */
export interface FlowSection {
  /** Section ID, conventionally `SID1`, `SID2`, ... */
  id: string
  name: string
  description?: string
  order: number
}

export interface FlowMetadata {
  /** Human-readable flow name. */
  name?: string
  description?: string
  /** Top-level system prompt prepended to the agent's role messages. */
  preamble: string
  /** BCP-47-ish code: `en`, `uk`, `de`, ... */
  language: string
  /** Override the welcome message. */
  customStartMessage?: string
  /** Override the closing message. */
  customEndMessage?: string
  sections?: FlowSection[]
  /** Provider-specific voice id (e.g. Cartesia voice UUID). */
  voiceId?: string
  vadParams?: VadParams
  /** Hard cap on session duration, in seconds. */
  maxSessionDuration?: number
  /** Relative pacing hint for the agent. */
  conversationSpeed?: 'slow' | 'normal' | 'fast'
}

/**
 * Voice Activity Detection parameters.
 *
 * `stop_secs` is the silence threshold before the agent considers the user's
 * turn finished. Lower values feel snappier but increase interruption risk.
 */
export interface VadParams {
  stop_secs?: number
}

/** Reserved transition tokens. */
export const TRANSITION = {
  CONTINUE: '__continue__' as const,
  END: '__end__' as const,
}

/**
 * Backward-compat helper for legacy choices that used `text` instead of
 * `display`. Safe to run on already-normalized choices.
 */
export function normalizeChoice(choice: Record<string, unknown>): Choice {
  return {
    id: String(choice.id ?? ''),
    display: String(choice.display ?? choice.text ?? ''),
    value:
      choice.value !== undefined
        ? String(choice.value)
        : choice.display !== undefined
          ? String(choice.display)
          : choice.text !== undefined
            ? String(choice.text)
            : undefined,
    order: Number(choice.order ?? 0),
    transitionTo:
      choice.transitionTo !== undefined
        ? (String(choice.transitionTo) as Transition)
        : undefined,
  }
}

export function normalizeChoices(
  choices?: Array<Record<string, unknown>>
): Choice[] | undefined {
  if (!choices || choices.length === 0) return undefined
  return choices.map(normalizeChoice)
}
