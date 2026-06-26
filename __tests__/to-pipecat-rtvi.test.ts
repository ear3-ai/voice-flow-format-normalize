import { describe, test, expect } from 'vitest'
import { toPipecatRtvi, generateHandlers } from '../src/converters/to-pipecat-rtvi.js'
import type { ConversationFlow } from '../src/types.js'
import type { PipecatFlow } from '../src/pipecat-types.js'

// ─── Test Fixtures ──────────────────────────────────────────────────

/** Simple linear flow: 3 voice questions, no sections */
function createLinearFlow(): ConversationFlow {
  return {
    version: '2.0',
    steps: [
      {
        id: 'QID1',
        type: 'voice_input_single',
        text: 'What is your name?',
        required: true,
        order: 1,
      },
      {
        id: 'QID2',
        type: 'voice_input_single',
        text: 'What do you do for work?',
        required: true,
        order: 2,
      },
      {
        id: 'QID3',
        type: 'voice_input_single',
        text: 'Any final thoughts?',
        required: false,
        order: 3,
      },
    ],
    metadata: {
      preamble: 'You are a friendly interviewer.',
      language: 'en',
    },
  }
}

/** Flow with 3 sections, each with steps that transition between sections */
function createSectionedFlow(): ConversationFlow {
  return {
    version: '2.0',
    steps: [
      {
        id: 'QID1',
        type: 'voice_input_single',
        text: 'How do you define an insight?',
        required: true,
        order: 1,
        sectionId: 'SID1',
        next: 'SID2',
      },
      {
        id: 'QID2',
        type: 'voice_input_single',
        text: 'How do you interpret confidence scores?',
        required: true,
        order: 2,
        sectionId: 'SID2',
        next: '__continue__',
      },
      {
        id: 'QID3',
        type: 'multiple_choice_single',
        text: 'Rate your trust level',
        required: true,
        order: 3,
        sectionId: 'SID2',
        next: 'SID3',
        choices: [
          { id: 'C1', display: 'High', order: 1 },
          { id: 'C2', display: 'Medium', order: 2 },
          { id: 'C3', display: 'Low', order: 3 },
        ],
      },
      {
        id: 'QID4',
        type: 'voice_input_single',
        text: 'What improvements would you suggest?',
        required: true,
        order: 4,
        sectionId: 'SID3',
        next: '__end__',
      },
    ],
    metadata: {
      preamble: 'You are conducting a research interview.',
      language: 'en',
      customStartMessage: 'Welcome to the research interview!',
      customEndMessage: 'Thank you for your insights!',
      sections: [
        { id: 'SID1', name: 'Definitions', order: 1 },
        { id: 'SID2', name: 'Trust & Confidence', order: 2 },
        { id: 'SID3', name: 'Improvements', order: 3 },
      ],
    },
  }
}

/** Flow with conditional branching (MC choices with different transitionTo) */
function createBranchingFlow(): ConversationFlow {
  return {
    version: '2.0',
    steps: [
      {
        id: 'QID1',
        type: 'multiple_choice_single',
        text: 'What type of food do you prefer?',
        required: true,
        order: 1,
        sectionId: 'SID1',
        next: '__continue__',
        choices: [
          { id: 'C1', display: 'Pizza', order: 1, transitionTo: 'SID2' },
          { id: 'C2', display: 'Sushi', order: 2, transitionTo: 'SID3' },
        ],
      },
      {
        id: 'QID2',
        type: 'voice_input_single',
        text: 'What pizza toppings do you like?',
        required: true,
        order: 2,
        sectionId: 'SID2',
        next: '__end__',
      },
      {
        id: 'QID3',
        type: 'voice_input_single',
        text: 'What sushi rolls do you prefer?',
        required: true,
        order: 3,
        sectionId: 'SID3',
        next: '__end__',
      },
    ],
    metadata: {
      preamble: 'You are a food survey interviewer.',
      language: 'en',
      sections: [
        { id: 'SID1', name: 'Preference', order: 1 },
        { id: 'SID2', name: 'Pizza Details', order: 2 },
        { id: 'SID3', name: 'Sushi Details', order: 3 },
      ],
    },
  }
}

/** Flow with non-sequential orders (gap in ordering) */
function createGappedOrderFlow(): ConversationFlow {
  return {
    version: '2.0',
    steps: [
      { id: 'QID1', type: 'voice_input_single', text: 'First', required: true, order: 1 },
      { id: 'QID6', type: 'voice_input_single', text: 'Second', required: true, order: 6 },
      { id: 'QID10', type: 'voice_input_single', text: 'Third', required: true, order: 10 },
    ],
    metadata: { preamble: 'Test', language: 'en' },
  }
}

// ─── Flow Simulator ─────────────────────────────────────────────────

interface SimulationStep {
  node: string
  functionCalled: string
  transitionTo: string
}

/**
 * Walks the compiled graph as Pipecat's FlowManager would: at each node,
 * pick a function (by index) and follow its `transition_to` until `__end__`
 * or a dead end.
 */
function simulateFlow(
  flow: PipecatFlow,
  options?: { choiceIndex?: number; maxSteps?: number }
): {
  steps: SimulationStep[]
  reachedEnd: boolean
  error?: string
} {
  const maxSteps = options?.maxSteps ?? 100
  const choiceIndex = options?.choiceIndex ?? 0
  const steps: SimulationStep[] = []
  let currentNode = flow.initial_node

  for (let i = 0; i < maxSteps; i++) {
    const node = flow.nodes[currentNode]
    if (!node) {
      return {
        steps,
        reachedEnd: false,
        error: `Node "${currentNode}" not found in flow`,
      }
    }

    const functions = (node.functions || []) as Array<any>
    if (functions.length === 0 || currentNode === '__end__') {
      const hasEndAction = (node.post_actions || []).some(
        (a) => a.type === 'end_conversation'
      )
      if (hasEndAction || currentNode === '__end__') {
        return { steps, reachedEnd: true }
      }
      return {
        steps,
        reachedEnd: false,
        error: `Node "${currentNode}" has no functions and no end_conversation post_action — dead end`,
      }
    }

    const funcIndex = Math.min(choiceIndex, functions.length - 1)
    const funcOuter = functions[funcIndex]
    const func = funcOuter.function || funcOuter

    const transitionTo = func.transition_to
    if (!transitionTo) {
      return {
        steps,
        reachedEnd: false,
        error: `Function "${func.name}" in node "${currentNode}" has no transition_to`,
      }
    }

    steps.push({ node: currentNode, functionCalled: func.name, transitionTo })
    currentNode = transitionTo
  }

  return {
    steps,
    reachedEnd: false,
    error: `Exceeded max steps (${maxSteps}) — possible infinite loop`,
  }
}

function validateAllTransitions(flow: PipecatFlow): string[] {
  const errors: string[] = []
  const nodeNames = new Set(Object.keys(flow.nodes))

  for (const [nodeName, node] of Object.entries(flow.nodes)) {
    for (const funcOuter of (node.functions || []) as Array<any>) {
      const func = funcOuter.function || funcOuter
      if (func.transition_to && !nodeNames.has(func.transition_to)) {
        errors.push(
          `Node "${nodeName}" → function "${func.name}" → transition_to "${func.transition_to}" does not exist`
        )
      }
    }
  }

  if (!nodeNames.has(flow.initial_node)) {
    errors.push(`initial_node "${flow.initial_node}" does not exist in nodes`)
  }

  return errors
}

function findAllPaths(
  flow: PipecatFlow,
  maxDepth = 50
): { path: string[]; reachedEnd: boolean }[] {
  const results: { path: string[]; reachedEnd: boolean }[] = []

  function walk(node: string, path: string[], visited: Set<string>) {
    if (visited.has(node)) {
      results.push({ path: [...path], reachedEnd: false })
      return
    }

    const nodeConfig = flow.nodes[node]
    if (!nodeConfig) {
      results.push({ path: [...path], reachedEnd: false })
      return
    }

    path.push(node)

    if (node === '__end__' || (nodeConfig.functions || []).length === 0) {
      const hasEndAction = (nodeConfig.post_actions || []).some(
        (a) => a.type === 'end_conversation'
      )
      results.push({
        path: [...path],
        reachedEnd: hasEndAction || node === '__end__',
      })
      return
    }

    if (path.length > maxDepth) {
      results.push({ path: [...path], reachedEnd: false })
      return
    }

    visited.add(node)

    for (const funcOuter of (nodeConfig.functions || []) as Array<any>) {
      const func = funcOuter.function || funcOuter
      if (func.transition_to) {
        walk(func.transition_to, [...path], new Set(visited))
      }
    }
  }

  walk(flow.initial_node, [], new Set())
  return results
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('toPipecatRtvi - Flow Generation', () => {
  describe('Linear flow (no sections)', () => {
    const source = createLinearFlow()
    const flow = toPipecatRtvi(source)

    test('creates start, question, and end nodes', () => {
      expect(flow.initial_node).toBe('start')
      expect(flow.nodes['start']).toBeDefined()
      expect(flow.nodes['__end__']).toBeDefined()
      expect(flow.nodes['question_QID1']).toBeDefined()
      expect(flow.nodes['question_QID2']).toBeDefined()
      expect(flow.nodes['question_QID3']).toBeDefined()
    })

    test('start node has role_messages with preamble', () => {
      const start = flow.nodes['start']
      expect(start.role_messages).toBeDefined()
      expect(start.role_messages![0].content).toContain(
        'You are a friendly interviewer.'
      )
    })

    test('start node has confirm_start function → first question', () => {
      const start = flow.nodes['start']
      const func = (start.functions![0] as any).function
      expect(func.name).toBe('confirm_start')
      expect(func.transition_to).toBe('question_QID1')
    })

    test('step functions have sequential transitions', () => {
      const q1 = (flow.nodes['question_QID1'].functions![0] as any).function
      expect(q1.name).toBe('collect_qid1')
      expect(q1.transition_to).toBe('question_QID2')

      const q2 = (flow.nodes['question_QID2'].functions![0] as any).function
      expect(q2.name).toBe('collect_qid2')
      expect(q2.transition_to).toBe('question_QID3')

      const q3 = (flow.nodes['question_QID3'].functions![0] as any).function
      expect(q3.name).toBe('collect_qid3')
      expect(q3.transition_to).toBe('__end__')
    })

    test('end node has end_conversation post_action', () => {
      const end = flow.nodes['__end__']
      const endAction = end.post_actions!.find(
        (a) => a.type === 'end_conversation'
      )
      expect(endAction).toBeDefined()
    })

    test('all transitions point to existing nodes', () => {
      const errors = validateAllTransitions(flow)
      expect(errors).toEqual([])
    })
  })

  describe('Sectioned flow', () => {
    const source = createSectionedFlow()
    const flow = toPipecatRtvi(source)

    test('creates correct number of nodes', () => {
      // start + 4 steps + __end__ = 6
      expect(Object.keys(flow.nodes)).toHaveLength(6)
    })

    test('section transitions resolve to first step in target section', () => {
      const q1 = (flow.nodes['question_QID1'].functions![0] as any).function
      expect(q1.transition_to).toBe('question_QID2') // SID1 → SID2

      const q3 = (flow.nodes['question_QID3'].functions![0] as any).function
      expect(q3.transition_to).toBe('question_QID4') // SID2 → SID3
    })

    test('__continue__ resolves to next step by order', () => {
      const q2 = (flow.nodes['question_QID2'].functions![0] as any).function
      expect(q2.transition_to).toBe('question_QID3')
    })

    test('__end__ transition resolves correctly', () => {
      const q4 = (flow.nodes['question_QID4'].functions![0] as any).function
      expect(q4.transition_to).toBe('__end__')
    })

    test('custom start/end messages are used', () => {
      expect(flow.nodes['start'].task_messages[0].content).toContain(
        'Welcome to the research interview!'
      )
      expect(flow.nodes['__end__'].task_messages[0].content).toContain(
        'Thank you for your insights!'
      )
    })

    test('all transitions point to existing nodes', () => {
      const errors = validateAllTransitions(flow)
      expect(errors).toEqual([])
    })
  })

  describe('Branching flow (conditional MC)', () => {
    const source = createBranchingFlow()
    const flow = toPipecatRtvi(source)

    test('QID1 has separate functions per choice', () => {
      expect(flow.nodes['question_QID1'].functions!.length).toBe(2)
    })

    test('Pizza choice transitions to SID2 (QID2)', () => {
      const pizza = (flow.nodes['question_QID1'].functions![0] as any).function
      expect(pizza.transition_to).toBe('question_QID2')
    })

    test('Sushi choice transitions to SID3 (QID3)', () => {
      const sushi = (flow.nodes['question_QID1'].functions![1] as any).function
      expect(sushi.transition_to).toBe('question_QID3')
    })

    test('both branch endpoints lead to __end__', () => {
      const q2 = (flow.nodes['question_QID2'].functions![0] as any).function
      expect(q2.transition_to).toBe('__end__')

      const q3 = (flow.nodes['question_QID3'].functions![0] as any).function
      expect(q3.transition_to).toBe('__end__')
    })

    test('all transitions point to existing nodes', () => {
      const errors = validateAllTransitions(flow)
      expect(errors).toEqual([])
    })

    test('all paths reach __end__', () => {
      const paths = findAllPaths(flow)
      expect(paths.length).toBeGreaterThan(0)
      for (const p of paths) expect(p.reachedEnd).toBe(true)
    })
  })

  describe('Non-sequential order flow', () => {
    const source = createGappedOrderFlow()
    const flow = toPipecatRtvi(source)

    test('__continue__ with non-sequential orders looks for order+1 (documented behavior)', () => {
      // Orders 1, 6, 10. __continue__ from order 1 looks for order=2 → not found → __end__.
      // This documents current behavior — gapped orders require explicit `next` targets.
      const q1 = (flow.nodes['question_QID1'].functions![0] as any).function
      expect(q1.transition_to).toBe('__end__')
    })

    test('all transitions point to existing nodes', () => {
      const errors = validateAllTransitions(flow)
      expect(errors).toEqual([])
    })
  })
})

describe('Flow Simulation - Pipecat FlowManager', () => {
  describe('Linear flow walkthrough', () => {
    const source = createLinearFlow()
    const flow = toPipecatRtvi(source)

    test('complete flow: start → Q1 → Q2 → Q3 → __end__', () => {
      const result = simulateFlow(flow)

      expect(result.reachedEnd).toBe(true)
      expect(result.error).toBeUndefined()
      expect(result.steps).toHaveLength(4)

      expect(result.steps[0]).toEqual({
        node: 'start',
        functionCalled: 'confirm_start',
        transitionTo: 'question_QID1',
      })
      expect(result.steps[3]).toEqual({
        node: 'question_QID3',
        functionCalled: 'collect_qid3',
        transitionTo: '__end__',
      })
    })

    test('visits every step exactly once', () => {
      const result = simulateFlow(flow)
      const visitedNodes = result.steps.map((s) => s.node)
      expect(visitedNodes).toContain('question_QID1')
      expect(visitedNodes).toContain('question_QID2')
      expect(visitedNodes).toContain('question_QID3')
      expect(new Set(visitedNodes).size).toBe(visitedNodes.length)
    })
  })

  describe('Sectioned flow walkthrough', () => {
    const source = createSectionedFlow()
    const flow = toPipecatRtvi(source)

    test('complete flow: start → QID1 → QID2 → QID3 → QID4 → __end__', () => {
      const result = simulateFlow(flow)

      expect(result.reachedEnd).toBe(true)
      expect(result.steps).toHaveLength(5)

      expect(result.steps[0].transitionTo).toBe('question_QID1')
      expect(result.steps[1].transitionTo).toBe('question_QID2') // SID1 → SID2
      expect(result.steps[2].transitionTo).toBe('question_QID3') // __continue__
      expect(result.steps[3].transitionTo).toBe('question_QID4') // SID2 → SID3
      expect(result.steps[4].transitionTo).toBe('__end__')
    })
  })

  describe('Branching flow walkthrough', () => {
    const source = createBranchingFlow()
    const flow = toPipecatRtvi(source)

    test('Pizza path: start → QID1 → QID2 → __end__', () => {
      const result = simulateFlow(flow, { choiceIndex: 0 })
      expect(result.reachedEnd).toBe(true)
      expect(result.steps).toHaveLength(3)
      expect(result.steps[1].transitionTo).toBe('question_QID2')
    })

    test('Sushi path: start → QID1 → QID3 → __end__', () => {
      const result = simulateFlow(flow, { choiceIndex: 1 })
      expect(result.reachedEnd).toBe(true)
      expect(result.steps).toHaveLength(3)
      expect(result.steps[1].transitionTo).toBe('question_QID3')
    })

    test('all possible paths reach __end__', () => {
      const paths = findAllPaths(flow)
      expect(paths.every((p) => p.reachedEnd)).toBe(true)
    })
  })

  describe('Edge cases', () => {
    test('single-step flow', () => {
      const source: ConversationFlow = {
        version: '2.0',
        steps: [
          {
            id: 'QID1',
            type: 'voice_input_single',
            text: 'Only step',
            required: true,
            order: 1,
          },
        ],
        metadata: { preamble: 'Test', language: 'en' },
      }

      const flow = toPipecatRtvi(source)
      const result = simulateFlow(flow)

      expect(result.reachedEnd).toBe(true)
      expect(result.steps).toHaveLength(2)
      expect(result.steps[1].transitionTo).toBe('__end__')
    })

    test('multiple choice without conditional branching', () => {
      const source: ConversationFlow = {
        version: '2.0',
        steps: [
          {
            id: 'QID1',
            type: 'multiple_choice_single',
            text: 'Pick a color',
            required: true,
            order: 1,
            choices: [
              { id: 'C1', display: 'Red', order: 1 },
              { id: 'C2', display: 'Blue', order: 2 },
            ],
          },
          {
            id: 'QID2',
            type: 'voice_input_single',
            text: 'Why that color?',
            required: true,
            order: 2,
          },
        ],
        metadata: { preamble: 'Color survey', language: 'en' },
      }

      const flow = toPipecatRtvi(source)
      const result = simulateFlow(flow)

      expect(result.reachedEnd).toBe(true)
      expect(flow.nodes['question_QID1'].functions!.length).toBe(1)
    })

    test('likert scale step generates proper parameters', () => {
      const source: ConversationFlow = {
        version: '2.0',
        steps: [
          {
            id: 'QID1',
            type: 'likert_scale',
            text: 'Rate your experience',
            required: true,
            order: 1,
            scale: { min: 1, max: 5 },
          },
        ],
        metadata: { preamble: 'Rating', language: 'en' },
      }

      const flow = toPipecatRtvi(source)
      const func = (flow.nodes['question_QID1'].functions![0] as any).function
      expect(func.parameters.properties.rating).toBeDefined()
      expect(func.parameters.properties.rating.type).toBe('integer')
      expect(func.parameters.properties.rating.minimum).toBe(1)
      expect(func.parameters.properties.rating.maximum).toBe(5)
    })
  })
})

describe('generateHandlers', () => {
  test('generates handlers for all steps + start + end', () => {
    const handlers = generateHandlers(createLinearFlow())

    expect(handlers['start_interview']).toBeDefined()
    expect(handlers['collect_qid1']).toBeDefined()
    expect(handlers['collect_qid2']).toBeDefined()
    expect(handlers['collect_qid3']).toBeDefined()
    expect(handlers['end_conversation_action']).toBeDefined()
  })

  test('handler names match function names in flow', () => {
    const source = createSectionedFlow()
    const flow = toPipecatRtvi(source)
    const handlers = generateHandlers(source)

    for (const [nodeName, node] of Object.entries(flow.nodes)) {
      if (nodeName === 'start' || nodeName === '__end__') continue
      for (const funcOuter of (node.functions || []) as Array<any>) {
        const func = funcOuter.function || funcOuter
        expect(handlers[func.name]).toBeDefined()
      }
    }
  })

  test('documented mismatch: start handler name vs flow function name', () => {
    // Known: flow uses `confirm_start`, handlers use `start_interview`.
    // OK because handlers are not required for the auto-generated start node.
    const source = createLinearFlow()
    const flow = toPipecatRtvi(source)
    const handlers = generateHandlers(source)

    const startFunc = (flow.nodes['start'].functions![0] as any).function
    expect(startFunc.name).toBe('confirm_start')
    expect(handlers['confirm_start']).toBeUndefined()
    expect(handlers['start_interview']).toBeDefined()
  })
})

describe('Transition integrity for real-world flow patterns', () => {
  test('20-step 4-section flow', () => {
    const source: ConversationFlow = {
      version: '2.0',
      steps: [
        { id: 'QID1', type: 'voice_input_single', text: 'Q1', required: true, order: 1, sectionId: 'SID1', next: 'SID2' },
        { id: 'QID6', type: 'voice_input_single', text: 'Q6', required: true, order: 2, sectionId: 'SID2', next: '__continue__' },
        { id: 'QID7', type: 'multiple_choice_single', text: 'Q7', required: true, order: 3, sectionId: 'SID2', next: '__continue__', choices: [{ id: 'C1', display: 'A', order: 1 }, { id: 'C2', display: 'B', order: 2 }] },
        { id: 'QID8', type: 'voice_input_single', text: 'Q8', required: true, order: 4, sectionId: 'SID2', next: '__continue__' },
        { id: 'QID9', type: 'voice_input_single', text: 'Q9', required: true, order: 5, sectionId: 'SID2', next: '__continue__' },
        { id: 'QID10', type: 'voice_input_single', text: 'Q10', required: true, order: 6, sectionId: 'SID2', next: '__continue__' },
        { id: 'QID11', type: 'voice_input_single', text: 'Q11', required: true, order: 7, sectionId: 'SID2', next: '__continue__' },
        { id: 'QID12', type: 'voice_input_single', text: 'Q12', required: true, order: 8, sectionId: 'SID2', next: '__continue__' },
        { id: 'QID13', type: 'voice_input_single', text: 'Q13', required: true, order: 9, sectionId: 'SID2', next: 'SID3' },
        { id: 'QID14', type: 'voice_input_single', text: 'Q14', required: true, order: 10, sectionId: 'SID3', next: '__continue__' },
        { id: 'QID15', type: 'voice_input_single', text: 'Q15', required: true, order: 11, sectionId: 'SID3', next: '__continue__' },
        { id: 'QID16', type: 'voice_input_single', text: 'Q16', required: true, order: 12, sectionId: 'SID3', next: '__continue__' },
        { id: 'QID17', type: 'voice_input_single', text: 'Q17', required: true, order: 13, sectionId: 'SID3', next: '__continue__' },
        { id: 'QID18', type: 'voice_input_single', text: 'Q18', required: true, order: 14, sectionId: 'SID3', next: '__continue__' },
        { id: 'QID19', type: 'voice_input_single', text: 'Q19', required: true, order: 15, sectionId: 'SID3', next: 'SID4' },
        { id: 'QID20', type: 'voice_input_single', text: 'Q20', required: true, order: 16, sectionId: 'SID4', next: '__continue__' },
        { id: 'QID21', type: 'voice_input_single', text: 'Q21', required: true, order: 17, sectionId: 'SID4', next: '__continue__' },
        { id: 'QID22', type: 'voice_input_single', text: 'Q22', required: true, order: 18, sectionId: 'SID4', next: '__continue__' },
        { id: 'QID23', type: 'multiple_choice_single', text: 'Q23', required: true, order: 19, sectionId: 'SID4', next: '__continue__', choices: [{ id: 'C1', display: 'A', order: 1 }, { id: 'C2', display: 'B', order: 2 }] },
        { id: 'QID24', type: 'voice_input_single', text: 'Q24', required: true, order: 20, sectionId: 'SID4', next: '__end__' },
      ],
      metadata: {
        preamble: 'Research interview.',
        language: 'en',
        customStartMessage: 'Welcome!',
        customEndMessage: 'Thank you!',
        sections: [
          { id: 'SID1', name: 'Section 1', order: 1 },
          { id: 'SID2', name: 'Section 2', order: 2 },
          { id: 'SID3', name: 'Section 3', order: 3 },
          { id: 'SID4', name: 'Section 4', order: 4 },
        ],
      },
    }

    const flow = toPipecatRtvi(source)

    expect(Object.keys(flow.nodes)).toHaveLength(22) // start + 20 + __end__

    const errors = validateAllTransitions(flow)
    expect(errors).toEqual([])

    const result = simulateFlow(flow)
    expect(result.reachedEnd).toBe(true)
    expect(result.steps).toHaveLength(21)

    expect(result.steps.find((s) => s.node === 'question_QID1')!.transitionTo).toBe('question_QID6')
    expect(result.steps.find((s) => s.node === 'question_QID13')!.transitionTo).toBe('question_QID14')
    expect(result.steps.find((s) => s.node === 'question_QID19')!.transitionTo).toBe('question_QID20')
    expect(result.steps.find((s) => s.node === 'question_QID24')!.transitionTo).toBe('__end__')
  })
})
