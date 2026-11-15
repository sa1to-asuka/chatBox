import { useEffect, useState } from 'react'
import { useAuth } from '../../services/auth.js'
import { navigate } from '../../services/navigation.js'
import { loadUsage, type UsageData } from '../../services/usage.js'
import { IconArrowLeftOutline16, IconDataOutline16, IconRefreshOutline16 } from '../base/icons.js'
import styles from './UsagePage.module.css'

const number = (value: number | null | undefined) => (value ?? 0).toLocaleString('zh-CN')
const resetLabel = (time: number) => new Intl.DateTimeFormat('zh-CN', {
  month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai',
}).format(time)
const statusLabel = (status: string) => status === 'settled' ? '已完成' : status === 'failed' ? '失败' : status === 'reserved' ? '生成中' : status

export const UsagePage = () => {
  const user = useAuth((state) => state.user)
  const [data, setData] = useState<UsageData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const refresh = () => {
    setLoading(true)
    void loadUsage()
      .then((value) => { setData(value); setError('') })
      .catch((cause) => setError(cause instanceof Error ? cause.message : '加载失败'))
      .finally(() => setLoading(false))
  }
  useEffect(refresh, [])
  useEffect(() => { document.title = '积分与用量 · Chatbox' }, [])
  const today = data?.today
  const usedPercent = today && !today.unlimited && today.allowance > 0
    ? Math.min(100, Math.round((today.used + today.reserved) / today.allowance * 100))
    : 0
  const trend = [...(data?.trend ?? [])].reverse()
  const maxTrend = Math.max(1, ...trend.map((item) => item.charged))
  return <main className={styles.page}>
    <header className={styles.header}>
      <button type="button" className={styles.back} onClick={() => navigate('/')}><IconArrowLeftOutline16 />返回聊天</button>
      <div className={styles.brand}><span className={styles.logo}>C</span>Chatbox</div>
      <button type="button" className={styles.iconButton} onClick={refresh} aria-label="刷新用量"><IconRefreshOutline16 /></button>
    </header>
    <div className={styles.content}>
      <div className={styles.titleRow}>
        <div><p>USAGE & CREDITS</p><h1>积分与用量</h1><span>{user?.displayName ?? ''} 的今日使用情况</span></div>
        <div className={styles.roleBadge}>{user?.role === 'vip' ? 'VIP 用户' : user?.role === 'admin' ? '管理员' : '普通用户'}</div>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      {loading && !data ? <div className={styles.loading}>正在读取用量…</div> : null}
      {today ? <>
        <section className={styles.quotaCard}>
          <div className={styles.quotaTop}>
            <div><span>今日剩余积分</span><strong>{today.unlimited ? '不限量' : number(today.remaining)}</strong></div>
            <div className={styles.reset}><span>重置时间</span><b>{resetLabel(today.resetAt)}</b><small>北京时间</small></div>
          </div>
          {today.unlimited ? <p className={styles.unlimitedHint}>积分不限量，仍会记录真实用量，不设每日上限。</p> : <div className={styles.bar} role="img" aria-label={`已使用 ${usedPercent}%`}>
            <span style={{ width: `${usedPercent}%` }} />
          </div>}
          <div className={styles.metrics}>
            <div><span>每日额度</span><b>{today.unlimited ? '不限量' : number(today.allowance)}</b></div>
            <div><span>已用</span><b>{number(today.used)}</b></div>
            <div><span>生成中预留</span><b>{number(today.reserved)}</b></div>
            <div><span>已用比例</span><b>{today.unlimited ? '—' : `${usedPercent}%`}</b></div>
          </div>
        </section>
        <div className={styles.grid}>
          <section className={styles.card}>
            <div className={styles.cardHead}><h2>最近 7 天</h2><span>积分消耗</span></div>
            <div className={styles.chart}>
              {trend.length === 0 ? <p className={styles.empty}>还没有用量记录</p> : trend.map((item) => <div key={item.day} className={styles.chartItem}>
                <div className={styles.barTrack}><span style={{ height: `${Math.max(4, item.charged / maxTrend * 100)}%` }} /></div>
                <small>{item.day.slice(5)}</small>
                <b>{item.charged > 999 ? `${(item.charged / 1000).toFixed(1)}k` : item.charged}</b>
              </div>)}
            </div>
          </section>
          <section className={styles.card}>
            <div className={styles.cardHead}><h2>按模型</h2><span>今天</span></div>
            {data?.byModel.length ? <div className={styles.modelRows}>{data.byModel.map((item) => <div key={item.modelId} className={styles.modelRow}>
              <span className={styles.modelIcon}><IconDataOutline16 /></span>
              <span><strong>{item.model}</strong><small>{item.requests} 次 · {number(item.inputTokens + item.outputTokens)} tokens{item.searchRequests ? ` · ${item.searchRequests} 次搜索` : ''}</small></span>
              <b>{number(item.charged)}</b>
            </div>)}</div> : <p className={styles.empty}>今天还没有消耗积分</p>}
          </section>
        </div>
        <section className={styles.card}>
          <div className={styles.cardHead}><h2>最近明细</h2><span>最多显示 100 条</span></div>
          {data?.recent.length ? <div className={styles.tableWrap}><table><thead><tr><th>时间</th><th>模型</th><th>输入 / 输出</th><th>搜索</th><th>积分</th><th>状态</th></tr></thead><tbody>
            {data.recent.map((item) => <tr key={item.requestId}>
              <td>{new Date(item.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</td>
              <td>{item.model}</td>
              <td>{number(item.inputTokens)} / {number(item.outputTokens)}{item.estimated ? <small>估算</small> : null}</td>
              <td>{item.searchRequests || '—'}</td>
              <td>{number(item.charged)}<small>× {item.multiplier}</small></td>
              <td><span className={item.status === 'failed' ? styles.failed : styles.done}>{statusLabel(item.status)}</span></td>
            </tr>)}
          </tbody></table></div> : <p className={styles.empty}>还没有使用记录</p>}
        </section>
      </> : null}
      <p className={styles.note}>积分每天按北京时间重新发放，不会结转。普通用户和 VIP 的每日默认额度由管理员设置；如需提升额度，请联系站点管理员。</p>
    </div>
  </main>
}
