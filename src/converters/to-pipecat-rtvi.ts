/**
 * Compile a {@link ConversationFlow} to a Pipecat RTVI flow.
 *
 * Pipecat flows are graphs of named nodes connected by function-call
 * transitions. This converter:
 *
 *   1. Turns each {@link FlowStep} into a node (`question_<id>`).
 *   2. Resolves abstract transitions (`__continue__`, section ids, `__end__`)
 *      to concrete node ids at compile time.
 *   3. Generates per-choice functions when a multiple-choice step has
 *      per-choice `transitionTo` overrides (conditional branching).
 *   4. Emits matching JS handler stubs via {@link generateHandlers}.
 *
 * The output is consumed by `pipecat-flows` (Python) or by any RTVI client.
 */

import type {
  ConversationFlow,
  FlowSection,
  FlowStep,
  Transition,
} from '../types.js'
import type {
  PipecatFlow,
  PipecatHandlers,
  PipecatNode,
} from '../pipecat-types.js'

type Section = Pick<FlowSection, 'id' | 'name' | 'order'>

/**
 * Resolve an abstract transition to a concrete node id.
 *
 * - `__end__` → `__end__`
 * - `__continue__` (or unset) → next step by order, else `__end__`
 * - `SID*` → first step in that section by order, else fall through to next
 * - anything else → assumed to be a step id (back-compat)
 */
function resolveTransition(
  transition: Transition | undefined,
  current: FlowStep,
  allSteps: FlowStep[],
  sections?: Section[]
): string {
  const target = transition || current.next || '__continue__'

  if (target === '__end__') return '__end__'

  if (target === '__continue__') {
    const next = allSteps.find((s) => s.order === current.order + 1)
    return next ? `question_${next.id}` : '__end__'
  }

  const isSection = sections?.some((s) => s.id === target)
  if (isSection) {
    const inSection = allSteps
      .filter((s) => s.sectionId === target)
      .sort((a, b) => a.order - b.order)
    if (inSection.length > 0) return `question_${inSection[0].id}`
    const next = allSteps.find((s) => s.order === current.order + 1)
    return next ? `question_${next.id}` : '__end__'
  }

  return `question_${target}`
}

const DEFAULT_START_MESSAGE =
  'Welcome to this conversation. Are you ready to begin?'

const DEFAULT_END_MESSAGE =
  'Thank you for completing this conversation. Your responses have been recorded. Have a great day!'

const DEFAULT_SYSTEM_PROMPT =
  'You are conducting a structured conversation. You must ALWAYS use the available functions to progress the conversation. This is a phone conversation and your responses will be converted to audio. Keep the conversation friendly, casual, and polite. Avoid outputting special characters and emojis.'

/**
 * Compile a `ConversationFlow` to a Pipecat RTVI flow graph.
 */
export function toPipecatRtvi(flow: ConversationFlow): PipecatFlow {
  const nodes: PipecatFlow['nodes'] = {}
  const sorted = [...flow.steps].sort((a, b) => a.order - b.order)
  const sections = flow.metadata.sections

  for (const step of sorted) {
    const nodeId = `question_${step.id}`
    const defaultNodeId = resolveTransition(step.next, step, sorted, sections)
    nodes[nodeId] = generateStepNode(step, defaultNodeId, sorted, sections)
  }

  const startMessage = flow.metadata.customStartMessage || DEFAULT_START_MESSAGE
  const firstStepId =
    sorted.length > 0 ? `question_${sorted[0].id}` : '__end__'

  nodes['start'] = {
    role_messages: [
      {
        role: 'system',
        content: `${DEFAULT_SYSTEM_PROMPT}\n\n${flow.metadata.preamble || ''}`,
      },
    ],
    task_messages: [
      {
        role: 'system',
        content: `Say: "${startMessage}"`,
      },
    ],
    functions: [
      {
        type: 'function',
        function: {
          name: 'confirm_start',
          description: 'Confirm user is ready to begin',
          transition_to: firstStepId,
          parameters: {
            type: 'object',
            properties: {
              ready: {
                type: 'boolean',
                description: 'User confirmation to start',
              },
            },
            required: ['ready'],
          },
        },
      },
    ],
  }

  const endMessage = flow.metadata.customEndMessage || DEFAULT_END_MESSAGE

  nodes['__end__'] = {
    role_messages: [],
    task_messages: [
      {
        role: 'system',
        content: `Say: "${endMessage}"`,
      },
    ],
    functions: [],
    post_actions: [
      { type: 'save_summary_conversation' },
      { type: 'save_html_conversation' },
      { type: 'end_conversation' },
    ],
  }

  return { initial_node: 'start', nodes }
}

function generateStepNode(
  step: FlowStep,
  defaultNodeId: string,
  allSteps: FlowStep[],
  sections?: Section[]
): PipecatNode {
  if (step.type === 'display_list') {
    const items = step.choices?.map((c) => c.display) || []
    const itemsText = items.map((item, i) => `${i + 1}. ${item}`).join('\n')
    return {
      role_messages: [],
      task_messages: [
        {
          role: 'system',
          content: `Present the following items to the user. These items are displayed on their screen. Read them aloud one by one:\n${itemsText}\n\nAfter reading all items, ask the user if they are ready to continue.`,
        },
      ],
      functions: [
        {
          type: 'function',
          function: {
            name: `acknowledge_${step.id.toLowerCase()}`,
            description:
              'User has reviewed the displayed items and is ready to continue',
            transition_to: defaultNodeId,
            parameters: {
              type: 'object',
              properties: {
                ready: {
                  type: 'boolean',
                  description: 'User is ready to continue',
                },
              },
              required: ['ready'],
            },
          },
        },
      ],
      node_data: {
        type: 'list',
        title: step.text,
        items,
        ...(step.overlayImageUrl ? { imageUrl: step.overlayImageUrl } : {}),
      },
    }
  }

  let promptContent = `Ask: "${step.text}"`

  if (step.sectionId && sections) {
    const section = sections.find((s) => s.id === step.sectionId)
    if (section) promptContent += `\n\n<!-- Section: ${section.name} -->`
  }

  if (step.type === 'multiple_choice_single' && step.choices) {
    const choiceLabels = step.choices.map((c) => c.display).join(', ')
    promptContent += `\n\nValid options are: ${choiceLabels}`
  } else if (step.type === 'multiple_choice_multiple' && step.choices) {
    const choiceLabels = step.choices.map((c) => c.display).join(', ')
    promptContent += `\n\nYou can select multiple options from: ${choiceLabels}`
  }

  const needsBranching =
    step.type === 'multiple_choice_single' &&
    !!step.choices &&
    step.choices.some((c) => c.transitionTo !== undefined)

  const functions = needsBranching
    ? generateBranchingFunctions(step, defaultNodeId, allSteps, sections)
    : [generateLinearFunction(step, defaultNodeId)]

  return {
    role_messages: [],
    task_messages: [{ role: 'system', content: promptContent }],
    functions,
    ...(step.attachedOverlayId
      ? { attached_overlay_id: `question_${step.attachedOverlayId}` }
      : {}),
  }
}

function generateLinearFunction(step: FlowStep, defaultNodeId: string) {
  return {
    type: 'function',
    function: {
      name: `collect_${step.id.toLowerCase()}`,
      description: `Collect response for: ${step.text}`,
      transition_to: defaultNodeId,
      parameters: generateFunctionParameters(step),
    },
  }
}

function generateBranchingFunctions(
  step: FlowStep,
  defaultNodeId: string,
  allSteps: FlowStep[],
  sections?: Section[]
) {
  if (!step.choices || step.choices.length === 0) {
    return [generateLinearFunction(step, defaultNodeId)]
  }

  return step.choices.map((choice) => {
    const choiceValue = choice.value || choice.display
    const targetNode = choice.transitionTo
      ? resolveTransition(choice.transitionTo, step, allSteps, sections)
      : resolveTransition('__continue__', step, allSteps, sections)

    return {
      type: 'function',
      function: {
        name: `collect_${step.id.toLowerCase()}_${choice.id}`,
        description: `User selected: ${choice.display}`,
        transition_to: targetNode,
        parameters: {
          type: 'object',
          properties: {
            answer: {
              type: 'string',
              enum: [choiceValue],
              description: choice.display,
            },
          },
          required: ['answer'],
        },
      },
    }
  })
}

function generateFunctionParameters(step: FlowStep) {
  switch (step.type) {
    case 'multiple_choice_single': {
      if (!step.choices || step.choices.length === 0) return defaultParams()
      return {
        type: 'object',
        properties: {
          answer: {
            type: 'string',
            enum: step.choices.map((c) => c.value || c.display),
            description: `Valid choices: ${step.choices
              .map((c) => c.display)
              .join(', ')}`,
          },
        },
        required: ['answer'],
      }
    }
    case 'multiple_choice_multiple': {
      if (!step.choices || step.choices.length === 0) return defaultParams()
      return {
        type: 'object',
        properties: {
          answers: {
            type: 'array',
            items: {
              type: 'string',
              enum: step.choices.map((c) => c.value || c.display),
            },
            description: `Can select multiple from: ${step.choices
              .map((c) => c.display)
              .join(', ')}`,
          },
        },
        required: ['answers'],
      }
    }
    case 'voice_input_single':
    case 'voice_input_multiline': {
      const description =
        step.type === 'voice_input_multiline'
          ? "User's detailed text response"
          : "User's text response"
      const params: Record<string, unknown> = {
        type: 'object',
        properties: { text: { type: 'string', description } as Record<string, unknown> },
        required: ['text'],
      }
      const textProp = (params.properties as Record<string, Record<string, unknown>>).text
      if (step.validation?.minLength != null) textProp.minLength = step.validation.minLength
      if (step.validation?.maxLength != null) textProp.maxLength = step.validation.maxLength
      return params
    }
    case 'likert_scale':
    case 'rating_scale': {
      if (!step.scale) return defaultParams()
      return {
        type: 'object',
        properties: {
          rating: {
            type: 'integer',
            minimum: step.scale.min,
            maximum: step.scale.max,
            description: `Rating from ${step.scale.min} to ${step.scale.max}`,
          },
        },
        required: ['rating'],
      }
    }
    default:
      return defaultParams()
  }
}

function defaultParams() {
  return {
    type: 'object',
    properties: {
      response: { type: 'string', description: 'User response' },
    },
    required: ['response'],
  }
}

/**
 * Emit JS source strings for each function declared in the compiled flow.
 *
 * These are passed to a runtime like `pipecat-flows` (which executes them
 * via QuickJS or similar) so a flow can be transported as data + a small
 * generated handler bundle.
 */
export function generateHandlers(flow: ConversationFlow): PipecatHandlers {
  const handlers: PipecatHandlers = {}
  const sorted = [...flow.steps].sort((a, b) => a.order - b.order)
  const sections = flow.metadata.sections

  const first = sorted[0]
  if (first) {
    handlers['start_interview'] = `async (args, flow_manager) => {
  return [args, 'question_${first.id}'];
}`
  }

  for (const step of sorted) {
    if (step.type === 'display_list') {
      const name = `acknowledge_${step.id.toLowerCase()}`
      const defaultNode = resolveTransition(step.next, step, sorted, sections)
      handlers[name] = `async (args, flow_manager) => {
  console.log('[${name}] User acknowledged display list');
  return [args, '${defaultNode}'];
}`
      continue
    }

    const name = `collect_${step.id.toLowerCase()}`
    const extract = generateAnswerExtraction(step)
    const defaultNode = resolveTransition(step.next, step, sorted, sections)
    const transition = generateTransitionLogic(
      step,
      defaultNode,
      sorted,
      sections
    )

    handlers[name] = `async (args, flow_manager) => {
  const answer = ${extract};
  flow_manager.state['${step.id}'] = answer;
  console.log('[${name}] Collected:', answer);
  ${transition}
}`
  }

  handlers['end_conversation_action'] = `async (action, flow_manager) => {
  console.log('[end_conversation_action] Conversation completed');
}`

  return handlers
}

function generateAnswerExtraction(step: FlowStep): string {
  switch (step.type) {
    case 'multiple_choice_single':
      return 'args.answer || args.choice || args.response'
    case 'multiple_choice_multiple':
      return 'args.answers || [args.answer] || []'
    case 'voice_input_single':
    case 'voice_input_multiline':
      return 'args.text || args.response'
    case 'likert_scale':
    case 'rating_scale':
      return 'args.rating || args.score'
    default:
      return 'args.response || args.answer'
  }
}

function generateTransitionLogic(
  step: FlowStep,
  defaultNext: string,
  allSteps: FlowStep[],
  sections?: Section[]
): string {
  if (!step.choices || step.choices.length === 0) {
    return `return [args, '${defaultNext}'];`
  }

  const withTransitions = step.choices.filter((c) => c.transitionTo !== undefined)
  if (withTransitions.length === 0) {
    return `return [args, '${defaultNext}'];`
  }

  const unique = new Set(withTransitions.map((c) => c.transitionTo))
  if (unique.size === 1) {
    const single = withTransitions[0].transitionTo!
    const resolved = resolveTransition(single, step, allSteps, sections)
    return `return [args, '${resolved}'];`
  }

  const map = step.choices
    .map((choice) => {
      const value = choice.value || choice.display
      const target = choice.transitionTo
        ? resolveTransition(choice.transitionTo, step, allSteps, sections)
        : defaultNext
      return `    '${value}': '${target}'`
    })
    .join(',\n')

  return `// Conditional branching based on answer
  const transitionMap = {
${map}
  };
  const nextNode = transitionMap[answer] || '${defaultNext}';
  return [args, nextNode];`
}
