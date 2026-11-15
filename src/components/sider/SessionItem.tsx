import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconEditOutline16, IconEllipsisOutline16, IconFolderOutline16, IconLinkOutline16, IconPinOutline16, IconTrashOutline16 } from '../base/icons.js'
import { renameSession, selectSession, setSessionFolder, setSessionPinned } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { loadFolders, useFolders } from '../../services/chat/folders.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { Menu } from '../base/Menu.js'
import { showToast } from '../base/toastState.js'
import { ShareDialog } from '../share/ShareDialog.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SessionItem.module.css'

export const SessionItem = memo(function SessionItem({
  session,
  active,
  onDelete,
}: {
  session: SessionSummary
  active: boolean
  onDelete: () => void
}) {
  const t = useTranslate()
  const folders = useFolders((state) => state.folders)
  const [editing, setEditing] = useState(false)
  const [moving, setMoving] = useState(false)
  const [sharing, setSharing] = useState(false)
  const displayTitle = session.title || t('untitledChat')
  const updatePin = async () => {
    try { await setSessionPinned(session.id, !session.pinned) }
    catch (error) { showToast(error instanceof Error ? error.message : '置顶操作失败') }
  }
  const move = async (folderId: string | null) => {
    setMoving(false)
    try { await setSessionFolder(session.id, folderId); await loadFolders() }
    catch (error) { showToast(error instanceof Error ? error.message : '移动失败') }
  }

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <>
      <div
        className={clsx(styles.item, active && styles.active, session.pinned && styles.pinned)}
        onClick={() => {
          selectSession(session.id)
          closeMobileSider()
        }}
      >
        {session.pinned ? <span className={styles.pinMark} aria-hidden><IconPinOutline16 /></span> : null}
        <div className={styles.title}>{displayTitle}</div>
        <div className={styles.action} onClick={(event) => event.stopPropagation()}>
          <Menu
            options={[
              {
                key: 'pin',
                label: session.pinned ? '取消置顶' : '置顶对话',
                icon: <IconPinOutline16 />,
                onSelect: () => void updatePin(),
              },
              {
                key: 'move',
                label: '移动到分类',
                icon: <IconFolderOutline16 />,
                onSelect: () => setMoving(true),
              },
              {
                key: 'share',
                label: '分享与导出',
                icon: <IconLinkOutline16 />,
                onSelect: () => setSharing(true),
              },
              {
                key: 'rename',
                label: t('sessionItemMenuRenameOption'),
                icon: <IconEditOutline16 />,
                onSelect: () => setEditing(true),
              },
              {
                key: 'delete',
                label: t('delete'),
                icon: <IconTrashOutline16 />,
                danger: true,
                onSelect: onDelete,
              },
            ]}
          >
            {({ toggle }) => (
              <IconButton icon={<IconEllipsisOutline16 />} aria-label={t('more')} onClick={toggle} />
            )}
          </Menu>
        </div>
      </div>
      {sharing ? <ShareDialog chatId={session.id} onClose={() => setSharing(false)} /> : null}
      {moving ? <Modal title="移动到分类" closable onClose={() => setMoving(false)}>
        <div className={styles.moveList}>
          <button type="button" className={!session.folderId ? styles.moveActive : ''} onClick={() => void move(null)}>
            <IconFolderOutline16 /><span>未分类</span>
            {!session.folderId ? <small>当前</small> : null}
          </button>
          {folders.map((folder) => <button
            type="button"
            key={folder.id}
            className={session.folderId === folder.id ? styles.moveActive : ''}
            onClick={() => void move(folder.id)}
          >
            <IconFolderOutline16 /><span>{folder.name}</span>
            {session.folderId === folder.id ? <small>当前</small> : null}
          </button>)}
          {folders.length === 0 ? <p className={styles.moveEmpty}>还没有分类，可在侧边栏新建。</p> : null}
        </div>
      </Modal> : null}
    </>
  )
})
