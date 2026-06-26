import { describe, test, expect } from 'vitest'
import {
  conversationFlowSchema,
  parseConversationFlow,
} from '../src/validators.js'
import type { ConversationFlow } from '../src/types.js'

const minimal: ConversationFlow = {
  version: '2.0',
  steps: [
    {
      id: 'Q1',
      type: 'voice_input_single',
      text: 'Say hi',
      required: true,
      order: 1,
    },
  ],
  metadata: { preamble: 'You are friendly.', language: 'en' },
}

describe('conversationFlowSchema', () => {
  test('accepts a minimal valid flow', () => {
    expect(parseConversationFlow(minimal)).toEqual(minimal)
  })

  test('rejects wrong version', () => {
    const bad = { ...minimal, version: '1.0' }
    expect(conversationFlowSchema.safeParse(bad).success).toBe(false)
  })

  test('rejects empty steps', () => {
    const bad = { ...minimal, steps: [] }
    expect(conversationFlowSchema.safeParse(bad).success).toBe(false)
  })

  test('rejects duplicate step ids', () => {
    const bad: ConversationFlow = {
      ...minimal,
      steps: [
        { ...minimal.steps[0] },
        { ...minimal.steps[0], order: 2 },
      ],
    }
    const result = conversationFlowSchema.safeParse(bad)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('Duplicate step id'))).toBe(true)
    }
  })

  test('rejects duplicate step orders', () => {
    const bad: ConversationFlow = {
      ...minimal,
      steps: [
        { ...minimal.steps[0], id: 'Q1' },
        { ...minimal.steps[0], id: 'Q2' },
      ],
    }
    const result = conversationFlowSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  test('rejects unknown sectionId reference', () => {
    const bad: ConversationFlow = {
      ...minimal,
      steps: [{ ...minimal.steps[0], sectionId: 'SID-MISSING' }],
    }
    const result = conversationFlowSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  test('accepts section with matching sectionId reference', () => {
    const ok: ConversationFlow = {
      ...minimal,
      steps: [{ ...minimal.steps[0], sectionId: 'SID1' }],
      metadata: {
        ...minimal.metadata,
        sections: [{ id: 'SID1', name: 'Intro', order: 1 }],
      },
    }
    expect(conversationFlowSchema.safeParse(ok).success).toBe(true)
  })

  test('rejects scale where max <= min', () => {
    const bad: ConversationFlow = {
      ...minimal,
      steps: [
        {
          ...minimal.steps[0],
          type: 'likert_scale',
          scale: { min: 5, max: 1 },
        },
      ],
    }
    expect(conversationFlowSchema.safeParse(bad).success).toBe(false)
  })
})
