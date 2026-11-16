import type { FastifyInstance } from 'fastify'
import { adminUser } from './auth.js'
import { db } from './db.js'
import { body, cleanText, sendError } from './http.js'
import {
  getAgentConfig,
  getSearchModel,
  resolveSearchBackend,
  saveAgentSettings,
  type AgentSearchBackend,
  type AgentSearchStyle,
} from './agent-config.js'
import { searchWeb } from './search.js'

const backendValues = new Set(['bing', 'mimo', 'none'])
const styleValues = new Set(['auto', 'json', 'native'])

const numberOrUndefined = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

export const registerAgentRoutes = (app: FastifyInstance) => {
  app.get('/api/admin/agent', async (request) => {
    adminUser(request)
    const config = getAgentConfig()
    const models = db.prepare(`SELECT m.id,m.display_name,m.upstream_id,m.premium,m.enabled,p.name provider,p.type
      FROM models m JOIN providers p ON p.id=m.provider_id ORDER BY p.name,m.display_name`)
      .all() as { id: string; display_name: string; upstream_id: string; premium: number; enabled: number; provider: string; type: string }[]
    return {
      config,
      models: models.map((model) => ({
        id: model.id,
        name: model.display_name,
        upstreamId: model.upstream_id,
        provider: model.provider,
        type: model.type,
        premium: Boolean(model.premium),
        enabled: Boolean(model.enabled),
      })),
      backendOptions: ['bing', 'mimo', 'none'],
      styleOptions: ['auto', 'json', 'native'],
    }
  })

  app.put('/api/admin/agent', async (request, reply) => {
    try {
      adminUser(request)
      const data = body(request)
      const searchBackend = typeof data.searchBackend === 'string'
        ? data.searchBackend as AgentSearchBackend
        : undefined
      const searchStyle = typeof data.searchStyle === 'string'
        ? data.searchStyle as AgentSearchStyle
        : undefined
      if (searchBackend && !backendValues.has(searchBackend)) throw new Error('搜索后端不正确')
      if (searchStyle && !styleValues.has(searchStyle)) throw new Error('搜索方式不正确')
      const searchModelId = data.searchModelId === null
        ? null
        : typeof data.searchModelId === 'string' ? cleanText(data.searchModelId, 100) || null : undefined
      saveAgentSettings({
        ...(typeof data.enabled === 'boolean' ? { enabled: data.enabled } : {}),
        ...(typeof data.presearch === 'boolean' ? { presearch: data.presearch } : {}),
        ...(searchBackend ? { searchBackend } : {}),
        ...(searchStyle ? { searchStyle } : {}),
        ...(searchModelId !== undefined ? { searchModelId } : {}),
        ...(numberOrUndefined(data.maxRounds) !== undefined ? { maxRounds: numberOrUndefined(data.maxRounds) } : {}),
        ...(numberOrUndefined(data.maxSearches) !== undefined ? { maxSearches: numberOrUndefined(data.maxSearches) } : {}),
        ...(numberOrUndefined(data.maxFiles) !== undefined ? { maxFiles: numberOrUndefined(data.maxFiles) } : {}),
      })
      return { config: getAgentConfig() }
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post('/api/admin/agent/probe', async (request, reply) => {
    try {
      adminUser(request)
      const data = body(request)
      const query = cleanText(
        typeof data.query === 'string' && data.query.trim() ? data.query : '2026 年 AI 行业最新动态',
        200
      )
      const config = getAgentConfig()
      const backend = resolveSearchBackend(config)
      if (!backend) return { ok: false, error: '未配置联网搜索后端' }
      const started = Date.now()
      const outcome = await searchWeb(backend, query, {
        signal: AbortSignal.timeout(25_000),
        summaryModel: getSearchModel(config.searchModelId),
      })
      return {
        ok: outcome.ok,
        latencyMs: Date.now() - started,
        backend: backend.kind,
        ...(outcome.ok
          ? {
              summary: outcome.summary.slice(0, 800),
              sources: outcome.sources.map((source) => ({ title: source.title, url: source.url })),
            }
          : { code: outcome.code, error: outcome.error }),
      }
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
