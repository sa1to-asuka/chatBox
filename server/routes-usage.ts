import type { FastifyInstance } from 'fastify'
import { currentUser } from './auth.js'
import { db } from './db.js'
import { allowanceFor } from './quota.js'
import { beijingDay, beijingResetAt } from '../shared/types.js'

export const registerUsageRoutes = (app: FastifyInstance) => {
  app.get('/api/usage/me', async (request) => {
    const user = currentUser(request)
    const day = beijingDay()
    const quota = db.prepare('SELECT allowance,used,reserved FROM quota_days WHERE user_id=? AND day=?')
      .get(user.id, day) as { allowance: number; used: number; reserved: number } | undefined
    const allowance = user.daily_quota ?? allowanceFor(user)
    const ledger = db.prepare(`SELECT COALESCE(SUM(charged),0) used FROM usage_ledger
      WHERE user_id=? AND day=? AND status IN ('settled','failed')`).get(user.id, day) as { used: number }
    const used = user.unlimited ? ledger.used : quota?.used ?? ledger.used
    const reserved = user.unlimited ? 0 : quota?.reserved ?? 0
    const byModel = db.prepare(`SELECT l.model_id modelId,
        COALESCE(m.display_name, '已删除模型') model,
        SUM(l.input_tokens) inputTokens, SUM(l.output_tokens) outputTokens,
        SUM(l.charged) charged, SUM(l.search_requests) searchRequests, COUNT(*) requests
      FROM usage_ledger l LEFT JOIN models m ON m.id=l.model_id
      WHERE l.user_id=? AND l.day=? AND l.status IN ('settled','failed')
      GROUP BY l.model_id ORDER BY charged DESC`).all(user.id, day)
    const trend = db.prepare(`SELECT day, SUM(input_tokens+output_tokens) tokens,
        SUM(charged) charged, SUM(search_requests) searches
      FROM usage_ledger WHERE user_id=? AND status IN ('settled','failed')
      GROUP BY day ORDER BY day DESC LIMIT 7`).all(user.id)
    const recent = db.prepare(`SELECT l.request_id requestId,
        COALESCE(m.display_name, '已删除模型') model, l.day,
        l.input_tokens inputTokens, l.output_tokens outputTokens,
        l.multiplier, l.charged, l.status, l.estimated,
        l.search_requests searchRequests, l.created_at createdAt
      FROM usage_ledger l LEFT JOIN models m ON m.id=l.model_id
      WHERE l.user_id=? ORDER BY l.created_at DESC LIMIT 100`).all(user.id) as { status: string; estimated: number }[]
    return {
      today: {
        day, allowance, used, reserved,
        remaining: user.unlimited ? null : Math.max(0, allowance - used - reserved),
        unlimited: user.unlimited === 1,
        resetAt: beijingResetAt(),
      },
      byModel,
      trend,
      recent: recent.map((item) => ({ ...item, estimated: item.estimated === 1 })),
    }
  })
}
