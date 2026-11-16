import Anthropic from '@anthropic-ai/sdk'
import type { InputContent } from './shared.js'
import {
  ToolUnsupportedError,
  isToolError,
  usageFrom,
  type ChatTool,
  type ProviderTurn,
  type RoundPart,
  type RoundResult,
  type ToolCall,
} from './turns.js'

const content = (value: InputContent): Anthropic.MessageParam['content'] => {
  if (typeof value === 'string') return value
  return value.map((part): Anthropic.ContentBlockParam => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type === 'image') {
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(part.mimeType)) {
        throw new Error('该模型不支持此图片格式')
      }
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: part.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: part.data,
        },
      }
    }
    return { type: 'text', text: `附件「${part.name}」内容：\n\n${part.text}` }
  })
}

const messagesOf = (turns: ProviderTurn[]): Anthropic.MessageParam[] => {
  const result: Anthropic.MessageParam[] = []
  for (const turn of turns) {
    if (turn.role === 'user') {
      result.push({ role: 'user', content: content(turn.content) })
    } else if (turn.role === 'tool') {
      const block: Anthropic.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: turn.toolCallId,
        content: turn.content,
        ...(turn.isError ? { is_error: true } : {}),
      }
      const last = result.at(-1)
      if (last?.role === 'user' && Array.isArray(last.content)) {
        last.content.push(block)
      } else {
        result.push({ role: 'user', content: [block] })
      }
    } else {
      const blocks: Anthropic.ContentBlockParam[] = []
      for (const thinking of turn.thinking ?? []) {
        if (thinking.text) {
          blocks.push({
            type: 'thinking',
            thinking: thinking.text,
            signature: thinking.signature ?? '',
          } as Anthropic.ContentBlockParam)
        }
      }
      if (turn.text) blocks.push({ type: 'text', text: turn.text })
      for (const call of turn.toolCalls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.input ?? {},
        })
      }
      result.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '' }] })
    }
  }
  return result
}

export async function* runAnthropicRound(
  provider: { key: string; base_url: string },
  input: {
    model: string
    system?: string
    messages: ProviderTurn[]
    maxTokens: number
    thinking: boolean
    tools?: ChatTool[]
    nativeWebSearch?: boolean
    signal: AbortSignal
  }
): AsyncGenerator<RoundPart, RoundResult> {
  const client = new Anthropic({ apiKey: provider.key, baseURL: provider.base_url, timeout: 120_000, maxRetries: 0 })
  const nativeTools = input.nativeWebSearch
    ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }]
    : []
  const clientTools = (input.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }))
  const tools = [...nativeTools, ...clientTools]
  const params = {
    model: input.model,
    messages: messagesOf(input.messages),
    max_tokens: input.maxTokens,
    ...(input.system ? { system: input.system } : {}),
    ...(tools.length ? { tools } : {}),
    ...(input.thinking ? { thinking: { type: 'adaptive' as const, display: 'summarized' as const } } : {}),
  } as unknown as Parameters<typeof client.messages.stream>[0]
  let stream
  try {
    stream = client.messages.stream(params, { signal: input.signal })
  } catch (error) {
    if (tools.length && isToolError(error)) throw new ToolUnsupportedError()
    throw error
  }

  let text = ''
  let outputChars = 0
  let usageInput = 0
  let usageOutput = 0
  let hasUsage = false
  let stopReason: string | null = null
  const calls = new Map<number, { id: string; name: string; args: string; input?: unknown }>()
  const thinkingBlocks: { text: string; signature?: string }[] = []
  const thinkingByIndex = new Map<number, { text: string; signature: string }>()

  for await (const item of stream) {
    if (item.type === 'message_start') {
      usageInput += item.message.usage.input_tokens
        + (item.message.usage.cache_creation_input_tokens ?? 0)
        + (item.message.usage.cache_read_input_tokens ?? 0)
      usageOutput += item.message.usage.output_tokens
      hasUsage = true
    } else if (item.type === 'content_block_start') {
      const block = item.content_block as unknown as Record<string, unknown>
      if (block.type === 'tool_use') {
        const id = typeof block.id === 'string' ? block.id : `call_${item.index}`
        const name = typeof block.name === 'string' ? block.name : ''
        const initial = block.input && typeof block.input === 'object' ? block.input : undefined
        calls.set(item.index, { id, name, args: '', input: initial })
      } else if (block.type === 'thinking') {
        thinkingByIndex.set(item.index, {
          text: typeof block.thinking === 'string' ? block.thinking : '',
          signature: typeof block.signature === 'string' ? block.signature : '',
        })
      } else if (block.type === 'text' && typeof block.text === 'string' && block.text) {
        text += block.text
        outputChars += [...block.text].length
        yield { kind: 'text', text: block.text }
      }
    } else if (item.type === 'content_block_delta') {
      if (item.delta.type === 'text_delta') {
        text += item.delta.text
        outputChars += [...item.delta.text].length
        yield { kind: 'text', text: item.delta.text }
      } else if (item.delta.type === 'thinking_delta') {
        const thinking = thinkingByIndex.get(item.index) ?? { text: '', signature: '' }
        thinking.text += item.delta.thinking
        thinkingByIndex.set(item.index, thinking)
        outputChars += [...item.delta.thinking].length
        yield { kind: 'thinking', text: item.delta.thinking }
      } else if (item.delta.type === 'signature_delta') {
        const thinking = thinkingByIndex.get(item.index) ?? { text: '', signature: '' }
        thinking.signature += item.delta.signature
        thinkingByIndex.set(item.index, thinking)
      } else if (item.delta.type === 'citations_delta') {
        const citation = item.delta.citation as unknown as { url?: unknown; title?: unknown }
        if (typeof citation.url === 'string' && /^https?:\/\//i.test(citation.url)) {
          yield {
            kind: 'citation',
            url: citation.url,
            title: typeof citation.title === 'string' ? citation.title : citation.url,
          }
        }
      } else if (item.delta.type === 'input_json_delta') {
        const call = calls.get(item.index)
        if (call) call.args += item.delta.partial_json
      }
    } else if (item.type === 'content_block_stop') {
      const call = calls.get(item.index)
      if (call) {
        if (call.input === undefined) {
          try {
            call.input = call.args ? JSON.parse(call.args) : {}
          } catch {
            call.input = { __parse_error: true, raw: call.args }
          }
        }
      }
      const thinking = thinkingByIndex.get(item.index)
      if (thinking) {
        thinkingBlocks.push({
          text: thinking.text,
          ...(thinking.signature ? { signature: thinking.signature } : {}),
        })
      }
    } else if (item.type === 'message_delta') {
      usageOutput = item.usage.output_tokens
      hasUsage = true
      stopReason = item.delta.stop_reason ?? stopReason
    }
  }

  const toolCalls: ToolCall[] = [...calls.values()]
    .filter((call) => call.name)
    .map((call) => ({ id: call.id, name: call.name, input: call.input ?? {} }))
  const estimatedInput = Math.ceil(JSON.stringify(input.messages).length / 2.5)
  const usage = hasUsage
    ? usageFrom(usageInput, usageOutput, false)
    : usageFrom(estimatedInput, Math.ceil(outputChars / 2.5), true)
  const reason = toolCalls.length > 0
    ? 'tool_use'
    : stopReason === 'max_tokens' ? 'max_tokens' : 'end_turn'
  return {
    text,
    thinking: thinkingBlocks,
    toolCalls,
    stopReason: reason,
    usage,
    assistantTurn: {
      role: 'assistant',
      text,
      toolCalls,
      thinking: thinkingBlocks,
    },
  }
}
