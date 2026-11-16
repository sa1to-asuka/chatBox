import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { currentUser } from './auth.js'
import { db } from './db.js'
import { body, cleanText, HttpError, requireString, sendError } from './http.js'
import { messageText, readChat, visibleMessages } from './visibility.js'
import { getPlugin } from './plugins.js'

const folderName = (value: unknown) => cleanText(requireString(value, '文件夹名称', 40), 40)
const escapeLike = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
const snippetFor = (text: string, query: string) => {
  const compact = text.replace(/\s+/g, ' ').trim()
  const index = compact.toLocaleLowerCase().indexOf(query.toLocaleLowerCase())
  const start = Math.max(0, index < 0 ? 0 : index - 50)
  const value = compact.slice(start, start + 160)
  return `${start > 0 ? '…' : ''}${value}${start + 160 < compact.length ? '…' : ''}`
}
export const ownsFolder = (userId: string, folderId: string) =>
  Boolean(db.prepare('SELECT 1 FROM chat_folders WHERE user_id=? AND id=?').get(userId, folderId))

export const registerChatTools = (app: FastifyInstance) => {
  app.get('/api/folders', async (request) => {
    const user = currentUser(request)
    return {
      folders: db.prepare(`SELECT f.id,f.name,f.position,
          COUNT(c.id) sessionCount
        FROM chat_folders f LEFT JOIN chat_sessions c
          ON c.user_id=f.user_id AND c.folder_id=f.id
        WHERE f.user_id=? GROUP BY f.id ORDER BY f.position,f.created_at`).all(user.id),
    }
  })
  app.post('/api/folders', async (request, reply) => {
    try {
      const user = currentUser(request)
      const name = folderName(body(request).name)
      const id = randomUUID()
      const now = Date.now()
      const position = (db.prepare('SELECT COALESCE(MAX(position),0)+1 value FROM chat_folders WHERE user_id=?')
        .get(user.id) as { value: number }).value
      db.prepare(`INSERT INTO chat_folders(user_id,id,name,position,created_at,updated_at)
        VALUES(?,?,?,?,?,?)`).run(user.id, id, name, position, now, now)
      return { id, name, position, sessionCount: 0 }
    } catch (error) { return sendError(reply, error) }
  })
  app.patch('/api/folders/:id', async (request, reply) => {
    try {
      const user = currentUser(request)
      const id = (request.params as { id: string }).id
      const name = folderName(body(request).name)
      const result = db.prepare('UPDATE chat_folders SET name=?,updated_at=? WHERE user_id=? AND id=?')
        .run(name, Date.now(), user.id, id)
      if (!result.changes) throw new HttpError(404, '文件夹不存在')
      return { ok: true }
    } catch (error) { return sendError(reply, error) }
  })
  app.delete('/api/folders/:id', async (request) => {
    const user = currentUser(request)
    const id = (request.params as { id: string }).id
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare('UPDATE chat_sessions SET folder_id=NULL WHERE user_id=? AND folder_id=?').run(user.id, id)
      db.prepare('DELETE FROM chat_folders WHERE user_id=? AND id=?').run(user.id, id)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return { ok: true }
  })
  app.patch('/api/chats/:id/meta', async (request, reply) => {
    try {
      const user = currentUser(request)
      const chatId = (request.params as { id: string }).id
      const data = body(request)
      const chat = db.prepare('SELECT pinned_at pinnedAt,folder_id folderId,plugin_id pluginId FROM chat_sessions WHERE id=? AND user_id=?')
        .get(chatId, user.id) as { pinnedAt: number | null; folderId: string | null; pluginId: string | null } | undefined
      if (!chat) throw new HttpError(404, '会话不存在')
      let pinnedAt = chat.pinnedAt
      let folderId = chat.folderId
      let pluginId = chat.pluginId
      if (typeof data.pinned === 'boolean') pinnedAt = data.pinned ? Date.now() : null
      if (data.folderId === null) folderId = null
      else if (typeof data.folderId === 'string') {
        if (!ownsFolder(user.id, data.folderId)) throw new HttpError(400, '文件夹不存在')
        folderId = data.folderId
      }
      if (data.pluginId === null) pluginId = null
      else if (typeof data.pluginId === 'string') {
        const plugin = getPlugin(data.pluginId)
        if (!plugin) throw new HttpError(400, '插件不存在')
        pluginId = plugin.id
      }
      db.prepare('UPDATE chat_sessions SET pinned=?,pinned_at=?,folder_id=?,plugin_id=?,updated_at=? WHERE id=? AND user_id=?')
        .run(pinnedAt ? 1 : 0, pinnedAt, folderId, pluginId, Date.now(), chatId, user.id)
      return { pinned: Boolean(pinnedAt), pinnedAt, folderId, pluginId }
    } catch (error) { return sendError(reply, error) }
  })
  app.get('/api/search', async (request) => {
    const user = currentUser(request)
    const query = requireString((request.query as { q?: unknown }).q, '搜索词', 100)
    const requested = Number((request.query as { limit?: unknown }).limit ?? 30)
    const limit = Math.max(1, Math.min(50, Number.isFinite(requested) ? Math.floor(requested) : 30))
    const pattern = `%${escapeLike(query)}%`
    const titleRows = db.prepare(`SELECT id,title,updated_at updatedAt,pinned,pinned_at pinnedAt,folder_id folderId
      FROM chat_sessions WHERE user_id=? AND title LIKE ? ESCAPE '\\'
      ORDER BY updated_at DESC LIMIT ?`).all(user.id, pattern, limit) as {
        id: string; title: string; updatedAt: number; pinned: number; pinnedAt: number | null; folderId: string | null
      }[]
    const messageRows = db.prepare(`SELECT session_id sessionId FROM chat_messages
      WHERE user_id=? AND data LIKE ? ESCAPE '\\'
      GROUP BY session_id ORDER BY MAX(created_at) DESC LIMIT 100`).all(user.id, pattern) as { sessionId: string }[]
    const ids = [...new Set([...titleRows.map((row) => row.id), ...messageRows.map((row) => row.sessionId)])].slice(0, 100)
    const results = new Map<string, {
      id: string; title: string; updatedAt: number; pinned: boolean; folderId: string | null;
      matches: { messageId: string; role: string; snippet: string; createdAt: number }[]
    }>()
    for (const row of titleRows) {
      results.set(row.id, {
        id: row.id, title: row.title, updatedAt: row.updatedAt, pinned: Boolean(row.pinned),
        folderId: row.folderId, matches: [],
      })
    }
    for (const id of ids) {
      const chat = readChat(user.id, id)
      if (!chat) continue
      const matches = visibleMessages(chat).flatMap((message) => {
        const text = messageText(message)
        return text.toLocaleLowerCase().includes(query.toLocaleLowerCase())
          ? [{ messageId: message.id, role: message.role, snippet: snippetFor(text, query), createdAt: message.createdAt }]
          : []
      }).slice(0, 5)
      const summary = results.get(id)
      if (summary) {
        summary.matches = matches
      } else if (matches.length) {
        const row = db.prepare(`SELECT updated_at updatedAt,pinned,pinned_at pinnedAt,folder_id folderId
          FROM chat_sessions WHERE user_id=? AND id=?`).get(user.id, id) as {
            updatedAt: number; pinned: number; pinnedAt: number | null; folderId: string | null
          }
        results.set(id, {
          id, title: chat.title, updatedAt: row.updatedAt, pinned: Boolean(row.pinned),
          folderId: row.folderId, matches,
        })
      }
    }
    return { results: [...results.values()].slice(0, limit) }
  })
}
