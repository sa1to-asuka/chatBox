import { useCallback, useEffect, useState } from 'react'
import { navigate } from '../../services/navigation.js'
import { showToast } from '../base/toastState.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { PluginIcon } from '../plugins/PluginIcon.js'
import { formatBytes } from '../../services/office/protocol.js'
import {
  deleteWorkspaceTask,
  listWorkspaceTasks,
  retryWorkspaceTask,
  workspaceDownloadUrl,
  type WorkspaceOutputFormat,
  type WorkspaceTask,
} from '../../services/workspace/api.js'
import {
  IconArrowLeftOutline16,
  IconDownloadOutline16,
  IconFolderOutline16,
  IconRefreshOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import styles from './FilesPage.module.css'

type FormatFilter = 'all' | WorkspaceOutputFormat
type StatusFilter = 'all' | 'done' | 'active' | 'failed'

const formatLabel: Record<WorkspaceOutputFormat, string> = {
  pptx: 'PowerPoint',
  docx: 'Word',
  xlsx: 'Excel',
  pdf: 'PDF',
}

const formatIcon = (format: WorkspaceOutputFormat) =>
  format === 'pptx' ? 'slides' : format === 'docx' ? 'doc' : format === 'xlsx' ? 'table' : 'file'

const dateLabel = (time: number) => new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
}).format(time)

const statusLabel = (task: WorkspaceTask) => {
  if (task.expired) {return '已过期'}
  if (task.status === 'queued') {return '排队中'}
  if (task.status === 'processing') {return '处理中'}
  if (task.status === 'failed') {return '失败'}
  return '已完成'
}

const expiryLabel = (task: WorkspaceTask) => {
  if (task.expired) {return '已过期'}
  const remaining = Math.max(0, (task.expiresAt - Date.now()) / 86_400_000)
  return remaining < 1 ? '今天到期' : `剩余 ${Math.ceil(remaining)} 天`
}

const currentStep = (task: WorkspaceTask) => {
  const running = task.steps.find((step) => step.status === 'running')
  return running?.detail || running?.label || ''
}

export const FilesPage = () => {
  const [format, setFormat] = useState<FormatFilter>('all')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [tasks, setTasks] = useState<WorkspaceTask[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<WorkspaceTask | null>(null)

  const load = useCallback(async (reset = false, cursor?: string | null) => {
    if (reset) {setLoading(true)}
    else {setLoadingMore(true)}
    try {
      const result = await listWorkspaceTasks({
        ...(format === 'all' ? {} : { format }),
        ...(status === 'all' ? {} : { status }),
        limit: 20,
        ...(cursor ? { cursor } : {}),
      })
      setTasks((current) => reset ? result.tasks : [...current, ...result.tasks])
      setNextCursor(result.nextCursor ?? null)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加载文件失败')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [format, status])

  useEffect(() => { void load(true) }, [load])
  useEffect(() => { document.title = '文件管理 · Chatbox' }, [])
  useEffect(() => {
    if (!tasks.some((task) => task.status === 'queued' || task.status === 'processing')) {return}
    const timer = window.setInterval(() => { void load(true) }, 2500)
    return () => window.clearInterval(timer)
  }, [tasks, load])

  const remove = async () => {
    if (!deleting) {return}
    try {
      await deleteWorkspaceTask(deleting.id)
      setDeleting(null)
      showToast('文件已删除')
      await load(true)
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : '删除失败')
    }
  }

  const retry = async (task: WorkspaceTask) => {
    try {
      await retryWorkspaceTask(task.id)
      showToast('已重新开始生成')
      await load(true)
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : '重试失败')
    }
  }

  const formats: { value: FormatFilter; label: string }[] = [
    { value: 'all', label: '全部' },
    { value: 'pptx', label: 'PPT' },
    { value: 'docx', label: 'Word' },
    { value: 'xlsx', label: 'Excel' },
    { value: 'pdf', label: 'PDF' },
  ]
  const statuses: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: '全部状态' },
    { value: 'done', label: '已完成' },
    { value: 'active', label: '处理中' },
    { value: 'failed', label: '失败' },
  ]

  return <main className={styles.page}>
    <header className={styles.header}>
      <button type="button" className={styles.back} onClick={() => navigate('/')}><IconArrowLeftOutline16 />返回聊天</button>
      <div className={styles.brand}><span className={styles.logo}>C</span>Chatbox</div>
      <button type="button" className={styles.iconButton} onClick={() => void load(true)} aria-label="刷新文件"><IconRefreshOutline16 /></button>
    </header>
    <div className={styles.content}>
      <div className={styles.titleRow}>
        <div><p>FILES & EXPORTS</p><h1>文件管理</h1><span>聊天里生成的 PPT、Word、Excel、PDF 和文件处理结果</span></div>
        <div className={styles.retention}><IconFolderOutline16 />文件保留 15 天</div>
      </div>
      <div className={styles.filters}>
        <div className={styles.chips} role="group" aria-label="文件类型">
          {formats.map((item) => <button key={item.value} type="button" className={format === item.value ? styles.chipActive : styles.chip} onClick={() => setFormat(item.value)}>{item.label}</button>)}
        </div>
        <div className={styles.chips} role="group" aria-label="文件状态">
          {statuses.map((item) => <button key={item.value} type="button" className={status === item.value ? styles.chipActive : styles.chip} onClick={() => setStatus(item.value)}>{item.label}</button>)}
        </div>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      {loading ? <div className={styles.loading}>正在读取文件…</div> : null}
      {!loading && tasks.length === 0 ? <div className={styles.empty}>
        <span className={styles.emptyIcon}><IconFolderOutline16 /></span>
        <strong>还没有文件</strong>
        <span>在聊天里上传文件或生成 PPT、Word、Excel 后，会出现在这里。</span>
      </div> : null}
      <div className={styles.list}>
        {tasks.map((task) => <article key={task.id} className={styles.card}>
          <span className={styles.fileIcon} data-format={task.outputFormat}><PluginIcon icon={formatIcon(task.outputFormat)} /></span>
          <div className={styles.info}>
            <div className={styles.nameRow}>
              <strong>{task.outputName || task.title || task.sourceName}</strong>
              <span className={task.status === 'failed' || task.expired ? styles.badgeFailed : task.status === 'done' ? styles.badgeDone : styles.badgeActive}>{statusLabel(task)}</span>
            </div>
            <span className={styles.meta}>
              {formatLabel[task.outputFormat]}
              {task.outputSize ? ` · ${formatBytes(task.outputSize)}` : ''}
              {' · '}{dateLabel(task.createdAt)}
            </span>
            {task.status === 'failed' && task.error ? <span className={styles.errorText}>{task.error}</span> : null}
            {task.status === 'processing' || task.status === 'queued' ? <span className={styles.progress}>{currentStep(task) || '正在服务器沙箱中处理…'}</span> : null}
            <span className={styles.expiry}>{expiryLabel(task)} · 保留至 {dateLabel(task.expiresAt)}</span>
          </div>
          <div className={styles.actions}>
            {task.status === 'done' && !task.expired ? <a className={styles.download} href={workspaceDownloadUrl(task.id)}>
              <IconDownloadOutline16 /><span>下载</span>
            </a> : null}
            {task.status === 'failed' ? <Button variant="outlined" size="s" onClick={() => void retry(task)}>重试</Button> : null}
            <button type="button" className={styles.delete} aria-label={`删除 ${task.outputName || task.title}`} onClick={() => setDeleting(task)}>
              <IconTrashOutline16 />
            </button>
          </div>
        </article>)}
      </div>
      {nextCursor ? <div className={styles.loadMore}>
        <Button variant="outlined" size="m" disabled={loadingMore} onClick={() => void load(false, nextCursor)}>
          {loadingMore ? '加载中…' : '加载更多'}
        </Button>
      </div> : null}
    </div>
    {deleting ? <Modal title="删除文件" closable onClose={() => setDeleting(null)} footer={<>
      <button type="button" className={styles.cancel} onClick={() => setDeleting(null)}>取消</button>
      <button type="button" className={styles.confirmDelete} onClick={() => void remove()}>确认删除</button>
    </>}>
      删除「{deleting.outputName || deleting.title}」后，聊天里的下载卡片也会失效；此操作不能恢复。
    </Modal> : null}
  </main>
}
