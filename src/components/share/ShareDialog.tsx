import { useEffect, useState } from 'react'
import { copyText } from '../../utils/clipboard.js'
import { createShare, downloadExport, getShare, revokeShare, shareUrl, type ShareInfo } from '../../services/share.js'
import { IconCheckOutline16, IconCopyOutline16, IconDownloadOutline16, IconLinkOutline16, IconTrashOutline16 } from '../base/icons.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import styles from './ShareDialog.module.css'

export const ShareDialog = ({ chatId, onClose }: { chatId: string; onClose: () => void }) => {
  const [share, setShare] = useState<ShareInfo>(null)
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    void getShare(chatId)
      .then(setShare)
      .catch((error) => showToast(error instanceof Error ? error.message : '分享状态加载失败'))
      .finally(() => setLoading(false))
  }, [chatId])
  const link = token ? shareUrl(token) : ''
  const create = async () => {
    setBusy(true)
    try {
      const value = await createShare(chatId)
      setToken(value.token)
      setShare({ id: value.id, createdAt: value.createdAt })
      if (await copyText(shareUrl(value.token))) {setCopied(true)}
    } catch (error) {
      showToast(error instanceof Error ? error.message : '创建分享失败')
    } finally { setBusy(false) }
  }
  const copy = async () => {
    if (!link) {return}
    if (await copyText(link)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } else {showToast('复制失败，请手动选择链接')}
  }
  const revoke = async () => {
    if (!share) {return}
    setBusy(true)
    try {
      await revokeShare(share.id)
      setShare(null)
      setToken('')
      showToast('分享已撤销')
    } catch (error) {
      showToast(error instanceof Error ? error.message : '撤销失败')
    } finally { setBusy(false) }
  }
  return <Modal title="分享与导出" closable onClose={onClose} className={styles.dialog}>
    <section className={styles.section}>
      <div className={styles.heading}><IconLinkOutline16 /><div><h3>只读分享链接</h3><p>任何拿到链接的人都能查看当前对话的快照，不包含思考过程和账号信息。之后的新消息不会自动加入。</p></div></div>
      {loading ? <p className={styles.muted}>正在读取分享状态…</p> : token ? <>
        <div className={styles.linkRow}><input readOnly value={link} onFocus={(event) => event.target.select()} /><button type="button" onClick={() => void copy()}>{copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}{copied ? '已复制' : '复制'}</button></div>
        <p className={styles.warning}>这是本次新生成的链接；关闭后无法再次查看，请先复制保存。需要刷新快照时可重新生成。</p>
        <div className={styles.actions}><button type="button" onClick={() => void create()} disabled={busy}>重新生成</button><button type="button" className={styles.danger} onClick={() => void revoke()} disabled={busy}><IconTrashOutline16 />撤销分享</button></div>
      </> : <>
        {share ? <p className={styles.muted}>此对话已有分享链接。出于安全原因，链接不会再次显示；如需复制请重新生成，旧链接会立即失效。</p> : <p className={styles.muted}>分享页面无需登录即可查看，公开链接可随时撤销。</p>}
        <div className={styles.actions}><button type="button" className={styles.primary} onClick={() => void create()} disabled={busy}>{share ? '重新生成链接' : '生成分享链接'}</button>{share ? <button type="button" className={styles.danger} onClick={() => void revoke()} disabled={busy}><IconTrashOutline16 />撤销分享</button> : null}</div>
      </>}
    </section>
    <section className={styles.section}>
      <div className={styles.heading}><IconDownloadOutline16 /><div><h3>导出对话</h3><p>导出当前可见分支。Markdown 适合阅读和归档，JSON 保留完整消息结构。</p></div></div>
      <div className={styles.exportActions}>
        <button type="button" onClick={() => downloadExport(chatId, 'md')}>Markdown</button>
        <button type="button" onClick={() => downloadExport(chatId, 'json')}>JSON</button>
      </div>
    </section>
  </Modal>
}
