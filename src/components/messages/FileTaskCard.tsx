import { useCallback, useEffect, useState } from 'react'
import { IconDocOutline16, IconDownloadOutline16 } from '../base/icons.js'
import { formatBytes } from '../../services/office/protocol.js'
import {
  getWorkspaceTask,
  retryWorkspaceTask,
  type WorkspaceOutputFormat,
  type WorkspaceTask,
} from '../../services/workspace/api.js'
import styles from './FileTaskCard.module.css'

const statusText: Record<WorkspaceTask['status'], string> = {
  queued: '排队中',
  processing: '处理中',
  done: '已完成',
  failed: '失败',
}

const formatText: Record<WorkspaceOutputFormat, string> = {
  docx: 'Word',
  xlsx: 'Excel',
  pptx: 'PowerPoint',
  pdf: 'PDF',
}

const mark = (status: WorkspaceTask['steps'][number]['status']) => {
  if (status === 'done') {return '✓'}
  if (status === 'failed') {return '!'}
  if (status === 'running') {return '…'}
  return ''
}

const formatDate = (value: number) => new Date(value).toLocaleString('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
})

/** 聊天内的文件任务卡片：轮询服务端处理进度，完成后直接给出下载入口。 */
export const FileTaskCard = ({
  taskId,
  sourceName,
  outputFormat,
}: {
  taskId: string
  sourceName: string
  outputFormat: WorkspaceOutputFormat
}) => {
  const [task, setTask] = useState<WorkspaceTask | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await getWorkspaceTask(taskId)
      setTask(data.task)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '文件任务加载失败')
    }
  }, [taskId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!task || (task.status !== 'queued' && task.status !== 'processing')) {return}
    const timer = window.setInterval(() => void load(), 1500)
    return () => window.clearInterval(timer)
  }, [task, load])

  const retry = async () => {
    try {
      const data = await retryWorkspaceTask(taskId)
      setTask(data.task)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重试失败')
    }
  }

  if (!task) {
    return (
      <div className={styles.card}>
        <div className={error ? styles.error : styles.loading}>
          {error || '正在读取文件任务…'}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.card}>
      <header className={styles.head}>
        <span className={styles.sourceIcon}><IconDocOutline16 /></span>
        <span className={styles.title}>
          <strong>{task.title || sourceName}</strong>
          <span>{task.sourceName || sourceName} → {formatText[task.outputFormat] ?? formatText[outputFormat]}</span>
        </span>
        <span className={`${styles.badge} ${styles[task.status]}`}>{statusText[task.status]}</span>
      </header>

      <ol className={styles.steps}>
        {task.steps.map((step) => (
          <li key={step.key} className={`${styles.step} ${styles[step.status]}`}>
            <span className={styles.dot}>{mark(step.status)}</span>
            <span>{step.label}</span>
            {step.detail ? <small>{step.detail}</small> : null}
          </li>
        ))}
      </ol>

      {task.plan.length > 0 ? (
        <div className={styles.plan}>
          <span>处理计划</span>
          <ol>{task.plan.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ol>
        </div>
      ) : null}

      {task.error ? <p className={styles.error}>{task.error}</p> : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <footer className={styles.foot}>
        {task.status === 'done' && task.outputName ? (
          <a
            className={styles.download}
            href={`/api/workspace/tasks/${encodeURIComponent(task.id)}/download`}
          >
            <IconDownloadOutline16 />
            下载 {task.outputName}
            {task.outputSize ? <small>{formatBytes(task.outputSize)}</small> : null}
          </a>
        ) : (
          <span className={styles.hint}>
            {task.status === 'failed' ? '处理失败，可重试' : 'Agent 正在服务器沙箱中处理…'}
          </span>
        )}
        <span className={styles.actions}>
          {task.status === 'failed' ? (
            <button type="button" className={styles.retry} onClick={() => void retry()}>重试</button>
          ) : null}
          <span className={styles.expiry}>保留至 {formatDate(task.expiresAt)}</span>
        </span>
      </footer>
    </div>
  )
}
