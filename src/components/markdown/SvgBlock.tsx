import { useEffect, useState } from 'react'
import { copyText } from '../../utils/clipboard.js'
import { IconExpandOutline16, IconRefreshOutline16 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { downloadBlob } from '../../services/office/download.js'
import { svgToPngBlob } from '../../services/media/svg.js'
import styles from './SvgBlock.module.css'

export const SvgBlock = ({ code, shareToken }: { code: string; shareToken?: string }) => {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [replay, setReplay] = useState(0)
  const [full, setFull] = useState(false)
  const hasScript = /<script[\s>]/i.test(code)
  useEffect(() => {
    let cancelled = false
    setUrl('')
    setError('')
    const endpoint = shareToken ? `/api/share/${encodeURIComponent(shareToken)}/svg-preview` : '/api/svg-preview'
    void fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
    }).then(async (response) => {
      const data = await response.json() as { url?: string; error?: string }
      if (!response.ok || !data.url) {throw new Error(data.error ?? '预览创建失败')}
      if (!cancelled) {setUrl(data.url)}
    }).catch((cause: unknown) => {
      if (!cancelled) {setError(cause instanceof Error ? cause.message : '预览创建失败')}
    })
    return () => { cancelled = true }
  }, [code, shareToken])

  const frame = <iframe
    key={replay}
    className={styles.frame}
    src={url || undefined}
    title="SVG 动画预览"
    sandbox="allow-scripts"
    referrerPolicy="no-referrer"
    allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; clipboard-read 'none'"
  />
  return <div className={styles.wrap}>
    {error ? <div className={styles.error}>{error}<span>可切换到源码查看</span></div> : null}
    {!url && !error ? <div className={styles.loading}>正在创建安全预览…</div> : null}
    {url ? frame : null}
    <div className={styles.tools}>
      {hasScript ? <span className={styles.badge}>隔离沙箱脚本</span> : null}
      <button type="button" onClick={() => setReplay((value) => value + 1)} aria-label="重播动画" title="重播动画"><IconRefreshOutline16 /></button>
      <button type="button" onClick={() => setFull(true)} aria-label="全屏预览" title="全屏预览"><IconExpandOutline16 /></button>
      <button type="button" onClick={() => void copyText(code).then((ok) => ok ? showToast('已复制 SVG') : showToast('复制失败'))} className={styles.textButton}>复制</button>
      <button type="button" className={styles.textButton} onClick={() => {
        const blob = new Blob([code], { type: 'image/svg+xml;charset=utf-8' })
        downloadBlob(blob, 'chatbox-svg.svg')
      }}>下载 SVG</button>
      <button type="button" className={styles.textButton} onClick={() => {
        void svgToPngBlob(code)
          .then((blob) => downloadBlob(blob, 'chatbox-svg.png'))
          .catch((cause: unknown) => showToast(cause instanceof Error ? cause.message : 'PNG 生成失败'))
      }}>下载 PNG</button>
    </div>
    {full ? <Modal title="SVG 动画预览" closable className={styles.fullDialog} mainClassName={styles.fullMain} onClose={() => setFull(false)}>
      {url ? <iframe className={styles.fullFrame} src={url} title="SVG 动画全屏预览" sandbox="allow-scripts" referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'; clipboard-read 'none'" /> : null}
      <p className={styles.fullNote}>SVG 在隔离沙箱中运行，无法访问 Chatbox 账号数据或外部网络。</p>
    </Modal> : null}
  </div>
}
