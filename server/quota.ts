import { db } from './db.js'
import { beijingDay, type ChatUsage } from '../shared/types.js'
import { HttpError } from './http.js'

export class QuotaError extends HttpError {
  constructor(message = '今日积分不足，请明天再来或联系管理员') { super(429, message, 'quota_exceeded') }
}
type QuotaRow = { allowance: number; reserved: number; used: number }
type UserQuota = { id: string; role: string; daily_quota: number | null; unlimited: number }
export const allowanceFor = (user: UserQuota): number =>
  user.daily_quota ?? (user.role === 'vip' || user.role === 'admin' ? 2000000 : 200000)
export const estimateInputTokens = (text: string): number => {
  let units = 0
  for (const char of text) units += /[\u0000-\u007f]/.test(char) ? 1 : 2
  return Math.ceil(units / 2.5) + 32
}
export const reserve = (user: UserQuota, requestId: string, modelId: string, inputTokens: number, multiplier: number): void => {
  db.exec('BEGIN IMMEDIATE')
  try {
    const existing = db.prepare('SELECT status FROM usage_ledger WHERE request_id=?').get(requestId)
    if (existing) throw new HttpError(409, '该请求已提交，请勿重复发送')
    const day = beijingDay()
    const allowance = allowanceFor(user)
    db.prepare(`INSERT INTO quota_days(user_id,day,allowance) VALUES(?,?,?)
      ON CONFLICT(user_id,day) DO UPDATE SET allowance=excluded.allowance`).run(user.id, day, allowance)
    const quota = db.prepare('SELECT allowance,reserved,used FROM quota_days WHERE user_id=? AND day=?').get(user.id, day) as QuotaRow
    const remaining = user.unlimited ? Number.MAX_SAFE_INTEGER : quota.allowance - quota.used - quota.reserved
    if (!user.unlimited && Math.ceil(inputTokens * multiplier) > remaining) {
      throw new QuotaError('今日剩余积分不足以发送这段内容，请缩短上下文或联系管理员')
    }
    const outputLimit = user.unlimited ? 16384 : Math.max(1, Math.min(16384, Math.floor((remaining - inputTokens * multiplier) / multiplier)))
    if (!user.unlimited && outputLimit < 64) throw new QuotaError()
    const reserved = user.unlimited ? 0 : Math.ceil((inputTokens + outputLimit) * multiplier)
    if (!user.unlimited) {
      const update = db.prepare(`UPDATE quota_days SET reserved=reserved+?
        WHERE user_id=? AND day=? AND allowance-used-reserved>=?`).run(reserved, user.id, day, reserved)
      if (update.changes !== 1) throw new QuotaError()
    }
    db.prepare(`INSERT INTO usage_ledger(request_id,user_id,model_id,day,input_tokens,multiplier,reserved,status,created_at)
      VALUES(?,?,?,?,?,?,?,'reserved',?)`).run(requestId, user.id, modelId, day, inputTokens, multiplier, reserved, Date.now())
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
export const maxOutputFor = (user: UserQuota, inputTokens: number, multiplier: number): number => {
  if (user.unlimited) return 16384
  const day = beijingDay()
  const quota = db.prepare('SELECT allowance,reserved,used FROM quota_days WHERE user_id=? AND day=?').get(user.id, day) as QuotaRow
  return Math.max(64, Math.min(16384, Math.floor((quota.reserved / multiplier) - inputTokens)))
}
export const reconcileReservations = (): void => {
  const cutoff = Date.now() - 30 * 60 * 1000
  const stale = db.prepare(`SELECT request_id,user_id,day,reserved FROM usage_ledger
    WHERE status='reserved' AND created_at<?`).all(cutoff) as { request_id: string; user_id: string; day: string; reserved: number }[]
  if (!stale.length) return
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const row of stale) {
      db.prepare(`UPDATE quota_days SET reserved=MAX(0,reserved-?) WHERE user_id=? AND day=?`).run(row.reserved, row.user_id, row.day)
      db.prepare(`UPDATE usage_ledger SET status='failed',error='服务重启，预留已释放',settled_at=?
        WHERE request_id=? AND status='reserved'`).run(Date.now(), row.request_id)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
export const settle = (requestId: string, usage: ChatUsage, error?: string): void => {
  db.exec('BEGIN IMMEDIATE')
  try {
    const row = db.prepare(`SELECT l.*,u.unlimited FROM usage_ledger l JOIN users u ON u.id=l.user_id
      WHERE l.request_id=?`).get(requestId) as { user_id: string; day: string; reserved: number; multiplier: number; status: string; unlimited: number } | undefined
    if (!row || row.status !== 'reserved') { db.exec('COMMIT'); return }
    const charged = error && usage.output === 0 ? 0 : Math.ceil((usage.input + usage.output) * row.multiplier)
    db.prepare(`UPDATE usage_ledger SET input_tokens=?,output_tokens=?,charged=?,estimated=?,status=?,error=?,search_requests=?,settled_at=?
      WHERE request_id=?`).run(usage.input, usage.output, charged, usage.estimated ? 1 : 0,
        error ? 'failed' : 'settled', error?.slice(0, 500) ?? null, Math.max(0, usage.searches ?? 0), Date.now(), requestId)
    db.prepare(`UPDATE quota_days SET reserved=MAX(0,reserved-?),used=used+?
      WHERE user_id=? AND day=?`).run(row.reserved, charged, row.user_id, row.day)
    db.exec('COMMIT')
  } catch (cause) {
    db.exec('ROLLBACK')
    throw cause
  }
}
