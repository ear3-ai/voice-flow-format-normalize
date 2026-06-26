/**
 * Generate `schema/voice-flow.schema.json` from the Zod definition.
 * Run via `npm run schema:generate`.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { conversationFlowSchema } from '../src/validators.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const out = resolve(__dirname, '..', 'schema', 'voice-flow.schema.json')

const json = zodToJsonSchema(conversationFlowSchema, {
  name: 'ConversationFlow',
  $refStrategy: 'root',
})

writeFileSync(out, JSON.stringify(json, null, 2) + '\n', 'utf8')
console.log(`Wrote ${out}`)
