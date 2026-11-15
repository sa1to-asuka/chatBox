import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import { body, HttpError, sendError } from './http.js'
import { createSession, currentUser, extendSession, hashPassword, publicUser, tokenHash, verifyPassword } from './auth.js'
import { displayName, password, username } from './validation.js'

const attempts = new Map<string, { count: number; reset: number }>()
const rateLimit = (request: { ip: string }, max: number) => {
  const now = Date.now()
  const entry = attempts.get(request.ip)
  if (!entry || entry.reset < now) {
    attempts.set(request.ip, { count: 1, reset: now + 60000 })
    return
  }
  if (++entry.count > max) throw new HttpError(429, '操作过于频繁，请稍后再试')
  if (attempts.size > 10000) attempts.clear()
}
export const registerAuth = (app: FastifyInstance) => {
  app.post('/api/auth/register', async (request, reply) => {
    try {
      rateLimit(request, 5)
      const data = body(request)
      const name = username(data.username)
      const nameForDisplay = displayName(data.displayName, name)
      const hash = hashPassword(password(data.password))
      const id = randomUUID()
      try {
        db.prepare(`INSERT INTO users(id,username,display_name,password_hash,created_at)
          VALUES(?,?,?,?,?)`).run(id, name, nameForDisplay, hash, Date.now())
      } catch (error) {
        if (String(error).includes('UNIQUE')) throw new HttpError(409, '用户名已被使用')
        throw error
      }
      createSession(id, reply)
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(id) as Parameters<typeof publicUser>[0]
      return { user: publicUser(user) }
    } catch (error) { return sendError(reply, error) }
  })
  app.post('/api/auth/login', async (request, reply) => {
    try {
      rateLimit(request, 10)
      const data = body(request)
      const name = username(data.username)
      const pass = password(data.password)
      const user = db.prepare('SELECT * FROM users WHERE username=?').get(name) as (Parameters<typeof publicUser>[0] & { password_hash: string }) | undefined
      if (!user || !verifyPassword(pass, user.password_hash) || user.disabled) {
        throw new HttpError(401, '用户名或密码错误')
      }
      createSession(user.id, reply)
      return { user: publicUser(user) }
    } catch (error) { return sendError(reply, error) }
  })
  app.post('/api/auth/logout', async (request, reply) => {
    if (request.cookies.chat_session) db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(tokenHash(request.cookies.chat_session))
    reply.clearCookie('chat_session', { path: '/' })
    return { ok: true }
  })
  app.post('/api/auth/password', async (request, reply) => {
    try {
      const user = currentUser(request)
      const data = body(request)
      if (typeof data.currentPassword !== 'string' || typeof data.newPassword !== 'string') throw new HttpError(400, '请填写当前密码和新密码')
      const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(user.id) as { password_hash: string }
      if (!verifyPassword(data.currentPassword, row.password_hash)) throw new HttpError(400, '当前密码不正确')
      const next = password(data.newPassword)
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(next), user.id)
      db.prepare('DELETE FROM auth_sessions WHERE user_id=?').run(user.id)
      createSession(user.id, reply)
      return { ok: true }
    } catch (error) { return sendError(reply, error) }
  })
  app.get('/api/auth/me', async (request, reply) => {
    try {
      const user = currentUser(request)
      const token = request.cookies.chat_session
      if (token) extendSession(token, reply)
      return { user: publicUser(user) }
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) return { user: null }
      throw error
    }
  })
}
