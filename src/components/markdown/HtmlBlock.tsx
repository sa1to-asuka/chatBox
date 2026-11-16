import { useRef, useState } from 'react'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { downloadBlob } from '../../services/office/download.js'
import styles from './HtmlBlock.module.css'

const CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; form-action \'none\';">'
const BASE_STYLE = '<style>html,body{margin:0;padding:0;background:#fff;color:#1e2c24;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'Microsoft YaHei\',sans-serif}*{box-sizing:border-box}</style>'
// 不允许弹窗；链接改为 _blank，既避免链接把 iframe 导航到外部页面，也不会打开新标签。
const HEAD_SAFETY = `${CSP}<base target="_blank">${BASE_STYLE}`

const wrapHtml = (code: string): string => {
  if (/<html[\s>]/i.test(code)) {
    if (/<head[\s>]/i.test(code)) {
      return code.replace(/<head([^>]*)>/i, `<head$1>${HEAD_SAFETY}`)
    }
    return code.replace(/<html([^>]*)>/i, `<html$1><head>${HEAD_SAFETY}</head>`)
  }
  return `<!doctype html><html><head>${HEAD_SAFETY}</head><body>${code}</body></html>`
}

export const HtmlBlock = ({ code, loading = false }: { code: string; loading?: boolean }) => {
  const [showSource, setShowSource] = useState(false)
  const [full, setFull] = useState(false)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const doc = wrapHtml(code)

  const downloadHtml = () => {
    downloadBlob(new Blob([code], { type: 'text/html;charset=utf-8' }), 'chatbox-html.html')
  }

  const downloadPng = async () => {
    try {
      const body = frameRef.current?.contentDocument?.body
      if (!body) {throw new Error('预览尚未准备好')}
      const { toBlob } = await import('html-to-image')
      const blob = await toBlob(body, { pixelRatio: 2, backgroundColor: '#ffffff' })
      if (!blob) {throw new Error('PNG 生成失败')}
      downloadBlob(blob, 'chatbox-html.png')
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : 'PNG 生成失败')
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.label}>HTML 图形{loading ? ' · 内容生成中…' : ''}</span>
        <button type="button" onClick={() => setShowSource((value) => !value)}>
          {showSource ? '隐藏源码' : '查看源码'}
        </button>
        <button type="button" onClick={() => setFull(true)}>全屏</button>
        <button type="button" disabled={loading} onClick={downloadHtml}>下载 HTML</button>
        <button type="button" disabled={loading} onClick={() => void downloadPng()}>下载 PNG</button>
      </div>
      <iframe
        ref={frameRef}
        className={styles.frame}
        srcDoc={doc}
        title="HTML 图形预览"
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
      />
      {showSource ? <pre className={styles.source}>{code}</pre> : null}
      {full ? (
        <Modal
          title="HTML 图形预览"
          closable
          className={styles.fullDialog}
          mainClassName={styles.fullMain}
          onClose={() => setFull(false)}
        >
          <iframe
            className={styles.fullFrame}
            srcDoc={doc}
            title="HTML 图形全屏预览"
            sandbox="allow-same-origin"
            referrerPolicy="no-referrer"
          />
        </Modal>
      ) : null}
    </div>
  )
}
