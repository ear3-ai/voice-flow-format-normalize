/**
 * Pipecat RTVI flow output shape.
 *
 * This mirrors the structure consumed by `pipecat-flows` (Python) and the
 * RTVI protocol. Kept loose (`functions: unknown[]`) since Pipecat's function
 * schema evolves and we don't want to lock consumers to a specific revision.
 *
 * Source: https://github.com/pipecat-ai/pipecat-flows
 */

export interface PipecatFlow {
  initial_node: string
  nodes: Record<string, PipecatNode>
}

export interface PipecatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface PipecatNode {
  task_messages: PipecatMessage[]
  role_messages?: PipecatMessage[]
  functions?: unknown[]
  pre_actions?: PipecatAction[]
  post_actions?: PipecatAction[]
  context_strategy?: {
    strategy: 'append' | 'reset' | 'reset_with_summary'
    summary_prompt?: string
  }
  node_data?: PipecatNodeData
  respond_immediately?: boolean
  /** Non-standard hint used by some hosts to attach an overlay UI. */
  attached_overlay_id?: string
}

export interface PipecatNodeData {
  type: 'list'
  title: string
  items: string[]
  imageUrl?: string
}

export interface PipecatAction {
  type: string
  text?: string
  [key: string]: unknown
}

/** Handlers are serialized JS source strings, keyed by function name. */
export type PipecatHandlers = Record<string, string>
