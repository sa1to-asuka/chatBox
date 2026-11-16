import { useCallback, useEffect, useRef, useState } from 'react'
import { IconDownloadOutline16 } from '../base/icons.js'
import { PluginIcon } from '../plugins/PluginIcon.js'
import { buildDocxBlob } from '../../services/office/docx.js'
import { downloadBlob } from '../../services/office/download.js'
import { buildPptxBlob } from '../../services/office/pptx.js'
import { buildXlsxBlob } from '../../services/office/xlsx.js'
import {
  defaultFilename,
  ensureExtension,
  formatBytes,
  parseMeta,
  safeFilename,
  type OfficeKind,
} from '../../services/office/protocol.js'
import {
  saveWorkspaceArtifact,
  workspaceDownloadUrl,
  type WorkspaceTask,
} from '../../services/workspace/api.js'
import styles from './OfficeArtifact.module.css'

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

const renderServerPptx = async (code: string, title: string): Promise<Blob | null> => {
  try {
    const response = await fetch('/api/workspace/render-pptx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: code, title }),
    })
    if (!response.ok) {return null}
    if (!(response.headers.get('content-type') ?? '').includes('presentationml')) {return null}
    const blob = await response.blob()
    return blob.size > 0 ? new Blob([blob], { type: PPTX_MIME }) : null
  } catch {
    return null
  }
}

export const OfficeArtifact = ({
  kind,
  code,
  meta,
  loading = false,
  autoSave = false,
}: {
  kind: OfficeKind
  code: string
  meta?: string
  loading?: boolean
  /** JSON deck 等兼容格式自动保存一次到文件管理；普通 Office 代码块仍手动保存。 */
  autoSave?: boolean
}) => {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [showSource, setShowSource] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<WorkspaceTask | null>(null)
  const autoTried = useRef(false)
  const parsed = parseMeta(meta)
  const filename = ensureExtension(safeFilename(parsed.filename, defaultFilename(kind)), kind)
  const label = kind === 'xlsx' ? 'Excel 表格' : kind === 'docx' ? 'Word 文档' : 'PowerPoint 演示文稿'
  const icon = kind === 'xlsx' ? 'table' : kind === 'docx' ? 'doc' : 'slides'

  const save = useCallback(async () => {
    if (loading || saving || saved) {return}
    setSaving(true)
    setError('')
    try {
      const { task } = await saveWorkspaceArtifact({
        format: kind,
        title: filename.replace(/\.[^.]+$/, ''),
        content: code,
      })
      setSaved(task)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存到文件管理失败')
    } finally {
      setSaving(false)
    }
  }, [loading, saving, saved, kind, filename, code])

  const download = async () => {
    if (loading || working) {return}
    setWorking(true)
    setError('')
    try {
      if (saved) {
        const link = document.createElement('a')
        link.href = workspaceDownloadUrl(saved.id)
        link.click()
        return
      }
      const blob = kind === 'xlsx'
        ? await buildXlsxBlob(code, parsed.sheet)
        : kind === 'docx'
          ? await buildDocxBlob(code)
          : (await renderServerPptx(code, filename.replace(/\.pptx$/i, ''))) ?? await buildPptxBlob(code)
      downloadBlob(blob, filename)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '文件生成失败')
    } finally {
      setWorking(false)
    }
  }

  useEffect(() => {
    if (!autoSave || loading || saved || autoTried.current) {return}
    autoTried.current = true
    void save()
  }, [autoSave, loading, saved, save])

  return (
    <div className={styles.card}>
      <div className={styles.head}>
        <span className={styles.icon}><PluginIcon icon={icon} /></span>
        <span className={styles.info}>
          <strong>{filename}</strong>
          <span>{label} · {formatBytes(code.length)}{loading ? ' · 内容生成中…' : ''}{saved ? ' · 已保存到文件管理' : ''}</span>
        </span>
        <button type="button" className={styles.save} disabled={loading || saving || Boolean(saved)} onClick={() => void save()}>
          {saved ? '已保存' : saving ? '保存中…' : '保存到文件管理'}
        </button>
        <button type="button" className={styles.download} disabled={loading || working} onClick={() => void download()}>
          <IconDownloadOutline16 />
          <span>{loading ? '生成中…' : working ? '准备中…' : '下载'}</span>
        </button>
        <button type="button" className={styles.sourceToggle} onClick={() => setShowSource((value) => !value)}>
          {showSource ? '隐藏源码' : '查看源码'}
        </button>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      {showSource ? <pre className={styles.source}>{code}</pre> : null}
    </div>
  )
}
