import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { db } from './db.js'
import { HttpError } from './http.js'
import type { PublicUser } from '../shared/types.js'
import { beijingDay } from '../shared/types.js'

const key = createHash('sha256').update(process.env.CONFIG_SECRET ?? 'local-development-only-change-me').digest()
export const encrypt = (value: string): string => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  return [iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]
    .map((part) => part.toString('base64url')).join('.')
}
export const decrypt = (value: string): string => {
  const [iv, content, tag, auth] = value.split('.').map((part) => Buffer.from(part, 'base64url'))
  if (!iv || !content || !tag || !auth) throw new Error('Invalid encrypted config')
  const cipher = createDecipheriv('aes-256-gcm', key, iv)
  cipher.setAuthTag(auth)
  return Buffer.concat([cipher.update(content), cipher.final()]).toString('utf8')
}
export const hashPassword = (password: string): string => {
  const salt = randomBytes(16)
  return `${salt.toString('base64url')}:${scryptSync(password, salt, 64).toString('base64url')}`
}
export const verifyPassword = (password: string, stored: string): boolean => {
  const [salt, expected] = stored.split(':')
  if (!salt || !expected) return false
  const hash = scryptSync(password, Buffer.from(salt, 'base64url'), 64)
  const target = Buffer.from(expected, 'base64url')
  return hash.length === target.length && timingSafeEqual(hash, target)
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
const SESSION_DAYS = 90
const setSessionCookie = (token: string, reply: FastifyReply) => {
  const maxAge = SESSION_DAYS * 86400
  reply.setCookie('chat_session', token, {
    path: '/', httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true',
    maxAge, expires: new Date(Date.now() + maxAge * 1000),
  })
}
export const createSession = (userId: string, reply: FastifyReply) => {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  db.prepare('DELETE FROM auth_sessions WHERE expires_at<?').run(now)
  db.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?)').run(tokenHash(token), userId, now + SESSION_DAYS * 86400000, now)
  setSessionCookie(token, reply)
}
export const extendSession = (token: string, reply: FastifyReply) => {
  const now = Date.now()
  const result = db.prepare('UPDATE auth_sessions SET expires_at=? WHERE token_hash=? AND expires_at>?')
    .run(now + SESSION_DAYS * 86400000, tokenHash(token), now)
  if (result.changes) setSessionCookie(token, reply)
}
export type UserRow = {
  id: string; username: string; display_name: string; role: 'user' | 'vip' | 'admin'
  daily_quota: number | null; unlimited: number; disabled: number
}
export const publicUser = (user: UserRow): PublicUser => {
  const day = beijingDay()
  const quota = db.prepare('SELECT reserved,used FROM quota_days WHERE user_id=? AND day=?').get(user.id, day) as { reserved: number; used: number } | undefined
  const ledgerUsed = user.unlimited === 1
    ? (db.prepare(`SELECT COALESCE(SUM(charged),0) used FROM usage_ledger
        WHERE user_id=? AND day=? AND status IN ('settled','failed')`).get(user.id, day) as { used: number }).used
    : quota?.used ?? 0
  return {
    id: user.id, username: user.username, displayName: user.display_name, role: user.role,
    disabled: user.disabled === 1,
    unlimited: user.unlimited === 1,
    dailyQuota: user.daily_quota ?? (user.role === 'vip' || user.role === 'admin' ? 2000000 : 200000),
    quotaUsed: ledgerUsed, quotaReserved: user.unlimited === 1 ? 0 : quota?.reserved ?? 0,
  }
}
export const currentUser = (request: FastifyRequest): UserRow => {
  const token = request.cookies.chat_session
  if (!token) throw new HttpError(401, '请先登录', 'unauthorized')
  const row = db.prepare(`SELECT u.* FROM auth_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash(token), Date.now()) as UserRow | undefined
  if (!row || row.disabled) throw new HttpError(401, '登录已失效，请重新登录', 'unauthorized')
  return row
}
export const adminUser = (request: FastifyRequest): UserRow => {
  const user = currentUser(request)
  if (user.role !== 'admin') throw new HttpError(403, '没有管理员权限', 'forbidden')
  return user
}
