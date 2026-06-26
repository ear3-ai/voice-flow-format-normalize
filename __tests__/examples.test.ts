import { describe, test, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  parseConversationFlow,
} from '../src/validators.js'
import { toPipecatRtvi } from '../src/converters/to-pipecat-rtvi.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const examplesDir = join(__dirname, '..', 'examples')

const exampleFiles = readdirSync(examplesDir)
  .filter((f) => f.endsWith('.json'))
  .sort()

describe('shipped examples', () => {
  test('there are 5 examples', () => {
    expect(exampleFiles.length).toBe(5)
  })

  for (const file of exampleFiles) {
    describe(file, () => {
      const raw = JSON.parse(readFileSync(join(examplesDir, file), 'utf8'))

      test('validates against the schema', () => {
        expect(() => parseConversationFlow(raw)).not.toThrow()
      })

      test('compiles to a Pipecat RTVI flow with a start node', () => {
        const flow = parseConversationFlow(raw)
        const compiled = toPipecatRtvi(flow)
        expect(compiled.initial_node).toBe('start')
        expect(compiled.nodes['start']).toBeDefined()
        expect(compiled.nodes['__end__']).toBeDefined()
      })
    })
  }
})
