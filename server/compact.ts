import { randomUUID } from 'node:crypto'
import type { ChatUsage } from '../shared/types.js'
import { parse } from '../shared/types.js'
import { decrypt, type UserRow } from './auth.js'
import { db } from './db.js'
import { HttpError } from './http.js'
import { estimateInputTokens, maxOutputFor, reserve, settle } from './quota.js'
import { COMPACT_SYSTEM_PROMPT } from './prompts.js'
import type { ChatInput } from './providers/shared.js'
import { streamOpenAI } from './providers/openai.js'
import { streamAnthropic } from './providers/anthropic.js'
import { messageText, readChat, visibleMessages } from './visibility.js'

export type CompactModel = {
  id: string
  upstream_id: string
  provider_id: string
  provider_name: string
  type: 'openai' | 'anthropic'
  base_url: string
  api_key_encrypted: string
  multiplier: number
}

export type CompactResult = {
  summary: string
  compactedIds: string[]
  compactedAt: number
  updatedAt: number
  usage: ChatUsage
}

/** 收集流式适配器发出的 text_delta，复用现有 provider，不新增非流式路径。 */
export const collectReply = async (stream: AsyncGenerator<string, ChatUsage>): Promise<{ text: string; usage: ChatUsage }> => {
  let text = ''
  while (true) {
    const next = await stream.next()
    if (next.done) return { text, usage: next.value }
    for (const frame of next.value.split('\n\n')) {
      const dataLine = frame.split('\n').find((line) => line.startsWith('data: '))
      if (!dataLine) continue
      try {
        const value = JSON.parse(dataLine.slice(6)) as {
          type?: string
          delta?: { type?: string; text?: string }
        }
        if (value.type === 'content_block_delta' && value.delta?.type === 'text_delta' && typeof value.delta.text === 'string') {
          text += value.delta.text
        }
      } catch {
        // 忽略无法解析的帧；真正的上游错误会由 provider 生成器抛出。
      }
    }
  }
}

export const compactChat = async ({
  user,
  chatId,
  model,
  keepRecent,
  signal,
}: {
  user: UserRow
  chatId: string
  model: CompactModel
  keepRecent: number
  signal: AbortSignal
}): Promise<CompactResult> => {
  const session = db.prepare('SELECT revision,summary,compacted_ids FROM chat_sessions WHERE id=? AND user_id=?')
    .get(chatId, user.id) as { revision: number; summary: string | null; compacted_ids: string } | undefined
  if (!session) throw new HttpError(404, '会话不存在')
  const chat = readChat(user.id, chatId)
  if (!chat) throw new HttpError(404, '会话不存在')

  const previousIds = parse<string[]>(session.compacted_ids || '[]')
  const previous = new Set(previousIds)
  const candidates = visibleMessages(chat).filter((message) => !previous.has(message.id))
  if (candidates.length <= keepRecent + 2) {
    throw new HttpError(400, '对话太短，无需压缩', 'compact_too_short')
  }
  let cut = candidates.length - keepRecent
  // 压缩前缀必须以 user 结尾，保证保留部分从 user 开始，避免 Anthropic 角色交替问题。
  while (cut > 0 && candidates[cut]?.role !== 'user') cut--
  if (cut < 2) throw new HttpError(400, '可压缩的内容太少', 'compact_too_short')

  const prefix = candidates.slice(0, cut)
  const lines = prefix.map((message) => {
    const files = message.role === 'user' && Array.isArray(message.files)
      ? message.files.flatMap((file) => typeof file.name === 'string' ? [file.name] : [])
      : []
    const suffix = files.length ? `\n[附件：${files.join('、')}]` : ''
    return `${message.role === 'user' ? '用户' : '助手'}：${messageText(message).slice(0, 4000)}${suffix}`
  })
  const previousSummary = session.summary ? `已有摘要：\n${session.summary}\n\n` : ''
  const room = Math.max(0, 60000 - previousSummary.length)
  const transcript = previousSummary + lines.join('\n\n').slice(-room)

  const requestId = `compact:${randomUUID()}`
  const inputTokens = estimateInputTokens(COMPACT_SYSTEM_PROMPT + '\n' + transcript)
  reserve(user, requestId, model.id, inputTokens, model.multiplier)
  const maxTokens = Math.min(2048, maxOutputFor(user, inputTokens, model.multiplier))
  const usage: ChatUsage = { input: inputTokens, output: 0, estimated: true }
  let failed: string | undefined
  try {
    const provider = {
      id: model.provider_id, name: model.provider_name, type: model.type,
      base_url: model.base_url, key: decrypt(model.api_key_encrypted),
    }
    const input: ChatInput = {
      model: model.upstream_id,
      messages: [{ role: 'user', content: transcript }],
      maxTokens, thinking: false, searchMode: 'none', signal, usage,
      system: COMPACT_SYSTEM_PROMPT,
    }
    const stream = model.type === 'openai' ? streamOpenAI(provider, input) : streamAnthropic(provider, input)
    const result = await collectReply(stream)
    usage.input = result.usage.input
    usage.output = result.usage.output
    usage.estimated = result.usage.estimated
    const summary = result.text.trim().slice(0, 20000)
    if (!summary) throw new HttpError(502, '压缩失败：模型没有返回摘要', 'compact_empty')

    const compactedIds = [...new Set([...previousIds, ...prefix.map((message) => message.id)])]
    const now = Date.now()
    db.exec('BEGIN IMMEDIATE')
    try {
      const current = db.prepare('SELECT revision FROM chat_sessions WHERE id=? AND user_id=?')
        .get(chatId, user.id) as { revision: number } | undefined
      if (!current || current.revision !== session.revision) {
        throw new HttpError(409, '对话已在另一设备更新，请刷新后重试', 'revision_conflict')
      }
      db.prepare('UPDATE chat_sessions SET summary=?,compacted_ids=?,compacted_at=?,updated_at=? WHERE id=? AND user_id=?')
        .run(summary, JSON.stringify(compactedIds), now, now, chatId, user.id)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return { summary, compactedIds, compactedAt: now, updatedAt: now, usage }
  } catch (error) {
    failed = error instanceof HttpError ? error.message : error instanceof Error ? error.message : '压缩失败'
    throw error
  } finally {
    settle(requestId, usage, failed)
  }
}
