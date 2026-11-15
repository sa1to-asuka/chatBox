import type { FastifyInstance } from 'fastify'
import { createHash, randomBytes } from 'node:crypto'
import { currentUser } from './auth.js'
import { db } from './db.js'
import { body, HttpError, sendError } from './http.js'

type Preview = { html: string; expiresAt: number }
const previews = new Map<string, Preview>()
const TTL = 10 * 60 * 1000
const MAX_PREVIEWS = 100
const MAX_CODE = 256 * 1024
const attempts = new Map<string, { count: number; reset: number }>()

const clean = () => {
  const now = Date.now()
  for (const [id, value] of previews) if (value.expiresAt <= now) previews.delete(id)
  while (previews.size > MAX_PREVIEWS) previews.delete(previews.keys().next().value as string)
}
const rateLimit = (key: string) => {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.reset < now) {
    attempts.set(key, { count: 1, reset: now + 60_000 })
    return
  }
  if (++entry.count > 20) throw new HttpError(429, 'SVG 预览请求过于频繁')
  if (attempts.size > 5000) attempts.clear()
}
const documentFor = (code: string) => `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}body{display:flex;align-items:center;justify-content:center}svg{max-width:100%;max-height:100%}</style>
</head><body>${code}</body></html>`
const createPreview = (code: unknown) => {
  if (typeof code !== 'string' || !code.trim() || code.length > MAX_CODE) throw new HttpError(400, 'SVG 内容为空或超过 256 KB')
  if (!/<svg[\s>]/i.test(code)) throw new HttpError(400, '内容中未找到 SVG')
  clean()
  const id = randomBytes(18).toString('base64url')
  previews.set(id, { html: documentFor(code), expiresAt: Date.now() + TTL })
  return { id, url: `/api/svg-preview/${id}` }
}
const shareTokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
const shareExists = (token: string) => Boolean(db.prepare(
  'SELECT 1 FROM chat_shares WHERE token_hash=? AND revoked_at IS NULL'
).get(shareTokenHash(token)))
const previewRoute = (app: FastifyInstance) => {
  app.post('/api/svg-preview', async (request, reply) => {
    try {
      const user = currentUser(request)
      rateLimit(`user:${user.id}`)
      return createPreview(body(request).code)
    } catch (error) { return sendError(reply, error) }
  })
  app.post('/api/share/:token/svg-preview', async (request, reply) => {
    try {
      const token = (request.params as { token: string }).token
      if (!/^[A-Za-z0-9_-]{30,100}$/.test(token) || !shareExists(token)) throw new HttpError(404, '分享不存在')
      rateLimit(`share:${request.ip}`)
      return createPreview(body(request).code)
    } catch (error) { return sendError(reply, error) }
  })
  app.get('/api/svg-preview/:id', async (request, reply) => {
    clean()
    const preview = previews.get((request.params as { id: string }).id)
    if (!preview) throw new HttpError(404, '预览已过期')
    reply.headers({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      'X-Frame-Options': 'SAMEORIGIN',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    return reply.send(preview.html)
  })
}
export const registerSvgPreviewRoutes = previewRoute
