import { db } from './db.js'
import { parse } from '../shared/types.js'

export type StoredMessage = {
  id: string
  role: 'user' | 'assistant'
  createdAt: number
  parentId?: string | null
  selectedChildId?: string | null
  content?: string
  files?: { id?: string; name?: string; isImage?: boolean; mimeType?: string; size?: number }[]
  blocks?: { type?: string; text?: string; isTemplate?: boolean; citations?: unknown[] }[]
  [key: string]: unknown
}

export type StoredChat = {
  id: string
  title: string
  rootMessageId: string | null
  messages: StoredMessage[]
}

export const readChat = (userId: string, sessionId: string): StoredChat | null => {
  const chat = db.prepare(`SELECT id,title,root_message_id rootMessageId
    FROM chat_sessions WHERE id=? AND user_id=?`).get(sessionId, userId) as { id: string; title: string; rootMessageId: string | null } | undefined
  if (!chat) return null
  const rows = db.prepare('SELECT data FROM chat_messages WHERE user_id=? AND session_id=? ORDER BY created_at')
    .all(userId, sessionId) as { data: string }[]
  return {
    id: chat.id,
    title: chat.title,
    rootMessageId: chat.rootMessageId,
    messages: rows.map((row) => parse<StoredMessage>(row.data)),
  }
}

/** Mirrors src/services/chat/branches.ts getVisibleMessages for server-side sharing and search. */
export const visibleMessages = (chat: StoredChat): StoredMessage[] => {
  if (chat.rootMessageId === null) return chat.rootMessageId === null && chat.messages.length === 0 ? [] : chat.messages
  const byId = new Map(chat.messages.map((message) => [message.id, message]))
  const path: StoredMessage[] = []
  let current: string | null = chat.rootMessageId
  while (current) {
    const message = byId.get(current)
    if (!message) break
    path.push(message)
    byId.delete(current)
    current = message.selectedChildId ?? null
  }
  return path
}

export const messageText = (message: StoredMessage): string => {
  if (message.role === 'user') return typeof message.content === 'string' ? message.content : ''
  if (!Array.isArray(message.blocks)) return ''
  return message.blocks
    .filter((block) => block.type === 'text' && !block.isTemplate && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

export const messageFileIds = (messages: StoredMessage[]): string[] => [
  ...new Set(messages.flatMap((message) => message.role === 'user' && Array.isArray(message.files)
    ? message.files.flatMap((file) => typeof file.id === 'string' ? [file.id] : [])
    : [])),
]
