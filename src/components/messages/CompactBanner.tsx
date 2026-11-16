import clsx from 'clsx'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconCompressOutline16,
} from '../base/icons.js'
import styles from './CompactBanner.module.css'

const formatTime = (value?: number | null) => {
  if (!value) {return ''}
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {return ''}
  return date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export const CompactBanner = ({
  summary,
  count,
  compactedAt,
  expanded,
  onToggle,
}: {
  summary: string
  count: number
  compactedAt?: number | null
  expanded: boolean
  onToggle: () => void
}) => (
  <div className={clsx(styles.banner, expanded && styles.expanded)}>
    <button type="button" className={styles.head} aria-expanded={expanded} onClick={onToggle}>
      <span className={styles.icon}><IconCompressOutline16 /></span>
      <span className={styles.headText}>
        <strong>已压缩 {count} 条早期消息</strong>
        <small>
          {formatTime(compactedAt)}
          {formatTime(compactedAt) ? ' · ' : ''}
          摘要仅作为背景，原始消息仍保留
        </small>
      </span>
      <span className={styles.chevron}>
        {expanded ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
      </span>
    </button>
    <div className={styles.summary}>{summary}</div>
    <div className={styles.actions}>
      <button type="button" onClick={onToggle}>{expanded ? '收起早期消息' : '展开早期消息'}</button>
    </div>
  </div>
)
