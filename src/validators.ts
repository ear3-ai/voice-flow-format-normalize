/**
 * Runtime validators built on Zod. Use these at IO boundaries (loading
 * user-supplied JSON, accepting API input). Internal code can rely on TS
 * types from `./types`.
 */

import { z } from 'zod'
import { FLOW_SCHEMA_VERSION } from './types.js'

export const stepTypeSchema = z.enum([
  'multiple_choice_single',
  'multiple_choice_multiple',
  'voice_input_single',
  'voice_input_multiline',
  'likert_scale',
  'rating_scale',
  'display_list',
])

export const transitionSchema = z.string().min(1)

export const choiceSchema = z.object({
  id: z.string().min(1),
  display: z.string().min(1),
  value: z.string().optional(),
  order: z.number().int().nonnegative(),
  transitionTo: transitionSchema.optional(),
})

export const textValidationSchema = z.object({
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().positive().optional(),
  pattern: z.string().optional(),
})

export const scaleSchema = z
  .object({
    min: z.number().int(),
    max: z.number().int(),
    minLabel: z.string().optional(),
    maxLabel: z.string().optional(),
  })
  .refine((s) => s.max > s.min, {
    message: 'scale.max must be greater than scale.min',
  })

export const flowSectionSchema = z.object({
  id: z.string().regex(/^SID/, 'Section id should start with "SID"'),
  name: z.string().min(1),
  description: z.string().optional(),
  order: z.number().int().nonnegative(),
})

export const vadParamsSchema = z.object({
  stop_secs: z.number().positive().optional(),
})

export const flowStepSchema = z.object({
  id: z.string().min(1),
  type: stepTypeSchema,
  text: z.string(),
  choices: z.array(choiceSchema).optional(),
  validation: textValidationSchema.optional(),
  scale: scaleSchema.optional(),
  required: z.boolean(),
  order: z.number().int().positive(),
  sectionId: z.string().optional(),
  next: transitionSchema.optional(),
  attachedOverlayId: z.string().optional(),
  overlayImageUrl: z.string().url().optional(),
})

export const flowMetadataSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  preamble: z.string(),
  language: z.string().min(2),
  customStartMessage: z.string().optional(),
  customEndMessage: z.string().optional(),
  sections: z.array(flowSectionSchema).optional(),
  voiceId: z.string().optional(),
  vadParams: vadParamsSchema.optional(),
  maxSessionDuration: z.number().positive().optional(),
  conversationSpeed: z.enum(['slow', 'normal', 'fast']).optional(),
})

export const conversationFlowSchema = z
  .object({
    version: z.literal(FLOW_SCHEMA_VERSION),
    steps: z.array(flowStepSchema).min(1, 'Flow must have at least one step'),
    metadata: flowMetadataSchema,
  })
  .superRefine((flow, ctx) => {
    const ids = new Set<string>()
    for (const s of flow.steps) {
      if (ids.has(s.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps'],
          message: `Duplicate step id: ${s.id}`,
        })
      }
      ids.add(s.id)
    }
    const orders = new Set<number>()
    for (const s of flow.steps) {
      if (orders.has(s.order)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps'],
          message: `Duplicate step order: ${s.order}`,
        })
      }
      orders.add(s.order)
    }
    const sectionIds = new Set(flow.metadata.sections?.map((s) => s.id) ?? [])
    for (const s of flow.steps) {
      if (s.sectionId && !sectionIds.has(s.sectionId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['steps'],
          message: `Step ${s.id} references unknown sectionId: ${s.sectionId}`,
        })
      }
    }
  })

/**
 * Parse and validate an unknown value as a {@link ConversationFlow}.
 * Throws `ZodError` on failure. Use `.safeParse` for non-throwing behavior.
 */
export function parseConversationFlow(input: unknown) {
  return conversationFlowSchema.parse(input)
}
