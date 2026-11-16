import 'dotenv/config'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { registerAuth } from './routes-auth.js'
import { registerApi } from './routes.js'
import { registerPluginRoutes } from './routes-plugins.js'
import { registerWorkspaceRoutes } from './routes-workspace.js'
import { cleanupWorkspace, markInterruptedWorkspaceTasks } from './workspace.js'
import { HttpError, sendError } from './http.js'
import { db } from './db.js'
import { reconcileReservations } from './quota.js'
import { registerUsageRoutes } from './routes-usage.js'
import { registerChatTools } from './routes-chat-tools.js'
import { registerShareRoutes } from './routes-share.js'
import { registerSvgPreviewRoutes } from './svg-preview.js'
import { registerAgentRoutes } from './routes-agent.js'

if (process.env.NODE_ENV === 'production' && (process.env.CONFIG_SECRET?.length ?? 0) < 32) {
  throw new Error('生产环境必须设置至少 32 个字符的 CONFIG_SECRET')
}

export const buildApp = async () => {
  reconcileReservations()
  markInterruptedWorkspaceTasks()
  void cleanupWorkspace()
  setInterval(() => void cleanupWorkspace(), 3_600_000).unref()
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test', trustProxy: process.env.TRUST_PROXY === 'true', bodyLimit: 1024 * 1024 })
  await app.register(cookie)
  await app.register(multipart, { limits: { fileSize: 32 * 1024 * 1024, files: 1 } })
  app.addHook('onSend', async (_request, reply) => {
    if (!reply.hasHeader('X-Content-Type-Options')) reply.header('X-Content-Type-Options', 'nosniff')
    if (!reply.hasHeader('X-Frame-Options')) reply.header('X-Frame-Options', 'DENY')
    if (!reply.hasHeader('Referrer-Policy')) reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
    if (!reply.hasHeader('Permissions-Policy')) reply.header('Permissions-Policy', 'camera=(), geolocation=()')
    if (!reply.hasHeader('Content-Security-Policy')) {
      reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
    }
  })
  app.addHook('preHandler', async (request) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) && request.url.startsWith('/api/')) {
      const origin = request.headers.origin
      if (origin) {
        const expected = `${request.protocol}://${request.headers.host}`
        if (origin !== expected) throw new HttpError(403, '请求来源无效', 'invalid_origin')
      }
    }
  })
  registerAuth(app)
  registerApi(app)
  registerPluginRoutes(app)
  registerWorkspaceRoutes(app)
  registerAgentRoutes(app)
  registerUsageRoutes(app)
  registerChatTools(app)
  registerShareRoutes(app)
  registerSvgPreviewRoutes(app)
  app.get('/api/health', async () => ({ ok: true }))
  app.setErrorHandler((error, _request, reply) => {
    if (process.env.NODE_ENV === 'test' && !(error instanceof HttpError)) console.error(error)
    const code = (error as { code?: string }).code
    if (code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: '文件不能超过 32 MB', code: 'file_too_large' })
    if (code?.startsWith('FST_')) return reply.code(400).send({ error: '上传内容格式不正确', code: 'invalid_upload' })
    return sendError(reply, error)
  })
  const dist = path.resolve(process.env.STATIC_DIR ?? './dist')
  if (existsSync(dist)) {
    await app.register(fastifyStatic, { root: dist, wildcard: true, index: 'index.html' })
    app.get('/robots.txt', async (_request, reply) => reply.type('text/plain').send('User-agent: *\nDisallow: /s/\n'))
    app.get('/s/:token', async (_request, reply) => {
      reply.headers({ 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store' })
      return reply.sendFile('index.html')
    })
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: '接口不存在' })
      return reply.sendFile('index.html')
    })
  }
  return app
}
if (process.env.NODE_ENV !== 'test') {
  const app = await buildApp()
  const port = Number(process.env.PORT ?? 3006)
  await app.listen({ host: process.env.HOST ?? '127.0.0.1', port })
  const cleanup = async () => { await app.close(); db.close(); process.exit(0) }
  process.on('SIGTERM', () => void cleanup())
  process.on('SIGINT', () => void cleanup())
}
