import type { FastifyInstance } from 'fastify'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { currentUser } from './auth.js'
import { db } from './db.js'
import { HttpError, sendError } from './http.js'
import { messageFileIds, messageText, readChat, visibleMessages } from './visibility.js'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { attachmentDir } from './db.js'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const activeShare = (userId: string, sessionId: string) => db.prepare(`SELECT id,created_at createdAt
  FROM chat_shares WHERE user_id=? AND session_id=? AND revoked_at IS NULL
  ORDER BY created_at DESC LIMIT 1`).get(userId, sessionId) as { id: string; createdAt: number } | undefined

const citationSources = (message: ReturnType<typeof visibleMessages>[number]) => {
  const urls = new Map<string, { url: string; title: string }>()
  for (const block of message.blocks ?? []) {
    for (const citation of block.citations ?? []) {
      if (!citation || typeof citation !== 'object') continue
      const item = citation as { url?: unknown; title?: unknown }
      if (typeof item.url !== 'string' || !/^https?:\/\//i.test(item.url)) continue
      urls.set(item.url, { url: item.url, title: typeof item.title === 'string' ? item.title : item.url })
    }
  }
  return [...urls.values()]
}

const snapshotFor = (userId: string, sessionId: string) => {
  const chat = readChat(userId, sessionId)
  if (!chat) throw new HttpError(404, '会话不存在')
  const visible = visibleMessages(chat)
  const messages = visible.map((message) => message.role === 'user'
    ? {
        id: message.id, role: 'user' as const, content: typeof message.content === 'string' ? message.content : '',
        files: Array.isArray(message.files) ? message.files.map((file) => ({
          id: typeof file.id === 'string' ? file.id : '',
          name: typeof file.name === 'string' ? file.name : '附件',
          isImage: file.isImage === true,
        })).filter((file) => file.id) : [],
        createdAt: message.createdAt,
      }
    : {
        id: message.id, role: 'assistant' as const, content: messageText(message),
        sources: citationSources(message),
        createdAt: message.createdAt,
      })
  return {
    snapshot: { title: chat.title || '未命名对话', messages },
    attachmentIds: messageFileIds(visible),
    createdAt: chat.messages[0]?.createdAt ?? Date.now(),
  }
}
const safeDownloadName = (title: string) => encodeURIComponent((title || 'chatbox').slice(0, 80).replace(/[\\/:*?"<>|]/g, '_'))

export const registerShareRoutes = (app: FastifyInstance) => {
  app.get('/api/chats/:id/shares', async (request) => {
    const user = currentUser(request)
    const chatId = (request.params as { id: string }).id
    const chat = db.prepare('SELECT 1 FROM chat_sessions WHERE id=? AND user_id=?').get(chatId, user.id)
    if (!chat) throw new HttpError(404, '会话不存在')
    return { share: activeShare(user.id, chatId) ?? null }
  })
  app.post('/api/chats/:id/shares', async (request, reply) => {
    try {
      const user = currentUser(request)
      const chatId = (request.params as { id: string }).id
      const { snapshot, attachmentIds } = snapshotFor(user.id, chatId)
      const token = randomBytes(32).toString('base64url')
      const id = randomUUID()
      const now = Date.now()
      db.exec('BEGIN IMMEDIATE')
      try {
        db.prepare('UPDATE chat_shares SET revoked_at=? WHERE user_id=? AND session_id=? AND revoked_at IS NULL')
          .run(now, user.id, chatId)
        db.prepare(`INSERT INTO chat_shares(id,token_hash,user_id,session_id,title,snapshot,attachment_ids,created_at)
          VALUES(?,?,?,?,?,?,?,?)`).run(id, hashToken(token), user.id, chatId, snapshot.title,
          JSON.stringify(snapshot), JSON.stringify(attachmentIds), now)
        db.exec('COMMIT')
      } catch (error) { db.exec('ROLLBACK'); throw error }
      return { id, token, createdAt: now }
    } catch (error) { return sendError(reply, error) }
  })
  app.delete('/api/shares/:id', async (request) => {
    const user = currentUser(request)
    db.prepare('UPDATE chat_shares SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL')
      .run(Date.now(), (request.params as { id: string }).id, user.id)
    return { ok: true }
  })
  app.get('/api/share/:token', async (request, reply) => {
    const token = (request.params as { token: string }).token
    if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) throw new HttpError(404, '分享不存在')
    const row = db.prepare(`SELECT id,title,snapshot,created_at createdAt
      FROM chat_shares WHERE token_hash=? AND revoked_at IS NULL`).get(hashToken(token)) as {
        id: string; title: string; snapshot: string; createdAt: number
      } | undefined
    if (!row) throw new HttpError(404, '分享不存在或已撤销')
    reply.headers({ 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' })
    return { id: row.id, title: row.title, snapshot: JSON.parse(row.snapshot), createdAt: row.createdAt }
  })
  app.get('/api/share/:token/files/:fileId', async (request, reply) => {
    const { token, fileId } = request.params as { token: string; fileId: string }
    const share = db.prepare('SELECT attachment_ids attachmentIds FROM chat_shares WHERE token_hash=? AND revoked_at IS NULL')
      .get(hashToken(token)) as { attachmentIds: string } | undefined
    if (!share || !(JSON.parse(share.attachmentIds) as string[]).includes(fileId)) throw new HttpError(404, '附件不存在')
    const file = db.prepare('SELECT name,storage_name storageName,mime_type mimeType,is_image isImage FROM attachments WHERE id=?')
      .get(fileId) as { name: string; storageName: string; mimeType: string; isImage: number } | undefined
    if (!file || !file.isImage) throw new HttpError(404, '附件不存在')
    const info = await stat(path.join(attachmentDir, file.storageName))
    reply.headers({
      'Content-Type': file.mimeType,
      'Content-Length': String(info.size),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    })
    return reply.send(createReadStream(path.join(attachmentDir, file.storageName)))
  })
  app.get('/api/chats/:id/export', async (request, reply) => {
    const user = currentUser(request)
    const chatId = (request.params as { id: string }).id
    const format = String((request.query as { format?: string }).format ?? 'md')
    const chat = readChat(user.id, chatId)
    if (!chat) throw new HttpError(404, '会话不存在')
    const visible = visibleMessages(chat)
    if (format === 'json') {
      reply.header('Content-Type', 'application/json; charset=utf-8')
      reply.header('Content-Disposition', `attachment; filename*=UTF-8''${safeDownloadName(chat.title)}.json`)
      return reply.send(JSON.stringify({ ...chat, messages: visible }, null, 2))
    }
    if (format !== 'md') throw new HttpError(400, '仅支持 Markdown 或 JSON 导出')
    const blocks = [`# ${chat.title || '未命名对话'}`, '']
    for (const message of visible) {
      const text = messageText(message).trim()
      if (!text && !(message.files?.length)) continue
      blocks.push(message.role === 'user' ? '## 用户' : '## Chatbox')
      if (text) blocks.push('', text)
      if (message.role === 'user' && message.files?.length) {
        blocks.push('', `附件：${message.files.map((file) => file.name || '附件').join('、')}`)
      }
      if (message.role === 'assistant') {
        const sources = citationSources(message)
        if (sources.length) blocks.push('', '来源：', ...sources.map((source) => `- [${source.title}](${source.url})`))
      }
      blocks.push('')
    }
    reply.header('Content-Type', 'text/markdown; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${safeDownloadName(chat.title)}.md`)
    return reply.send(blocks.join('\n'))
  })
}
