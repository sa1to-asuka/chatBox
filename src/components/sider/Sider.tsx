import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconEditOutline16,
  IconChevronDownOutline14,
  IconCloseOutline16,
  IconChevronRightOutline14,
  IconEllipsisOutline16,
  IconFolderOutline16,
  IconPanelLeftOutline16,
  IconPinOutline16,
  IconPluginOutline16,
  IconPlusOutline16,
  IconSearchOutline16,
  IconSettingsOutline16,
  NewChatIcon,
} from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { clearFolderLocally, newChat, removeSession, useChatStore } from '../../services/chat/store.js'
import { createFolder, deleteFolder, expandFolder, loadFolders, renameFolder, setActiveFolder, toggleFolder, useFolders } from '../../services/chat/folders.js'
import type { Folder } from '../../../shared/types.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { openGlobalSearch } from '../search/globalSearchState.js'
import { openPluginMarket } from '../plugins/pluginMarketState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import { AccountPanel } from '../account/AccountPanel.js'
import styles from './Sider.module.css'

type FolderDialog = { type: 'create' } | { type: 'rename'; folder: Folder } | { type: 'delete'; folder: Folder }

/** 展开的侧边栏：置顶、分类、时间分组，移动端放在抽屉里。 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const folders = useFolders((state) => state.folders)
  const activeFolderId = useFolders((state) => state.activeFolderId)
  const collapsed = useFolders((state) => state.collapsed)
  const [now, setNow] = useState(Date.now)
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [folderDialog, setFolderDialog] = useState<FolderDialog | null>(null)
  const [folderName, setFolderName] = useState('')
  const [folderBusy, setFolderBusy] = useState(false)
  useEffect(() => { void loadFolders() }, [])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {refresh()}
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const folderIds = new Set(folders.map((folder) => folder.id))
  const pinned = sessions.filter((session) => session.pinned)
  const unclassified = sessions.filter((session) => !session.pinned && (!session.folderId || !folderIds.has(session.folderId)))
  const activeFolder = folders.find((folder) => folder.id === activeFolderId)
  const groups = useMemo(() => groupSessions(unclassified, now, t), [unclassified, now, t])
  const byFolder = useMemo(() => {
    const result = new Map<string, SessionSummary[]>()
    for (const session of sessions) {
      if (session.pinned || !session.folderId) {continue}
      const list = result.get(session.folderId) ?? []
      list.push(session)
      result.set(session.folderId, list)
    }
    return result
  }, [sessions])

  const openFolderDialog = (dialog: FolderDialog) => {
    setFolderName(dialog.type === 'create' ? '' : dialog.folder.name)
    setFolderDialog(dialog)
  }
  const submitFolder = async () => {
    if (!folderDialog || folderBusy) {return}
    setFolderBusy(true)
    try {
      if (folderDialog.type === 'create') {
        if (!folderName.trim()) {return}
        await createFolder(folderName.trim())
      } else if (folderDialog.type === 'rename') {
        if (!folderName.trim()) {return}
        await renameFolder(folderDialog.folder.id, folderName.trim())
      } else {
        await deleteFolder(folderDialog.folder.id)
        clearFolderLocally(folderDialog.folder.id)
        if (activeFolderId === folderDialog.folder.id) {setActiveFolder(null)}
      }
      setFolderDialog(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '分类操作失败')
    } finally {
      setFolderBusy(false)
    }
  }

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>Chatbox</div>
        <div className={styles.topActions}>
          <IconButton
            size="m"
            icon={<IconSearchOutline16 />}
            tooltip="搜索对话"
            onClick={openGlobalSearch}
          />
          <IconButton
            size="m"
            icon={<IconPanelLeftOutline16 />}
            tooltip={t('collapseSiderbarButton')}
            tooltipPlacement="bottom"
            onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
          />
        </div>
      </div>
      <button
        type="button"
        className={styles.newChat}
        onClick={() => {
          newChat()
          closeMobileSider()
        }}
      >
        <span className={styles.newChatIcon}><NewChatIcon /></span>
        {t('newChat')}
      </button>
      <button
        type="button"
        className={clsx(styles.newChat, styles.pluginEntry)}
        onClick={() => {
          openPluginMarket()
          closeMobileSider()
        }}
      >
        <span className={styles.newChatIcon}><IconPluginOutline16 /></span>
        插件广场
      </button>
      <div className={styles.quickActions}>
        <button type="button" onClick={openGlobalSearch}><IconSearchOutline16 />搜索</button>
        <button type="button" onClick={() => openFolderDialog({ type: 'create' })}><IconFolderOutline16 />新建分类</button>
      </div>
      {activeFolder ? <div className={styles.folderContext}>
        <IconFolderOutline16 />
        <span>新对话将创建在「{activeFolder.name}」</span>
        <button type="button" aria-label="取消分类选择" onClick={() => setActiveFolder(null)}><IconCloseOutline16 /></button>
      </div> : null}
      <div className={styles.listWrap}>
        <div className={styles.list}>
          {pinned.length > 0 ? <div className={styles.section}>
            <div className={styles.sectionHeader}><span><IconPinOutline16 />置顶</span></div>
            {pinned.map((session) => <SessionItem key={session.id} session={session} active={session.id === activeId} onDelete={() => setDeleting(session)} />)}
          </div> : null}
          {folders.map((folder) => {
            const items = byFolder.get(folder.id) ?? []
            const isCollapsed = Boolean(collapsed[folder.id])
            return <div key={folder.id} className={clsx(styles.section, activeFolderId === folder.id && styles.sectionActive)}>
              <div className={styles.sectionHeader}>
                <button type="button" className={styles.folderToggle} aria-expanded={!isCollapsed} onClick={() => {
                  setActiveFolder(folder.id)
                  toggleFolder(folder.id)
                }}>
                  {isCollapsed ? <IconChevronRightOutline14 /> : <IconChevronDownOutline14 />}
                  <IconFolderOutline16 />
                  <span className={styles.folderName}>{folder.name}</span>
                  <small>{items.length}</small>
                </button>
                <span className={styles.headerActions}>
                  <IconButton size="m" icon={<IconPlusOutline16 />} tooltip={`在「${folder.name}」中新建对话`} onClick={() => {
                    setActiveFolder(folder.id)
                    expandFolder(folder.id)
                    newChat()
                    closeMobileSider()
                  }} />
                  <Menu options={[
                    { key: 'rename', label: '重命名分类', icon: <IconEditOutline16 />, onSelect: () => openFolderDialog({ type: 'rename', folder }) },
                    { key: 'delete', label: '删除分类', icon: <IconFolderOutline16 />, danger: true, onSelect: () => openFolderDialog({ type: 'delete', folder }) },
                  ]}>
                    {({ toggle }) => <IconButton icon={<IconEllipsisOutline16 />} aria-label="分类操作" onClick={toggle} />}
                  </Menu>
                </span>
              </div>
              {!isCollapsed ? (items.length > 0
                ? items.map((session) => <SessionItem key={session.id} session={session} active={session.id === activeId} onDelete={() => setDeleting(session)} />)
                : <button type="button" className={styles.folderEmpty} onClick={() => {
                  setActiveFolder(folder.id)
                  newChat()
                  closeMobileSider()
                }}>暂无对话，点击 + 新建</button>) : null}
            </div>
          })}
          {groups.map((group) => (
            <div key={group.key} className={styles.section}>
              <div className={styles.sectionHeader}><span>{group.label}</span></div>
              {group.sessions.map((session) => (
                <SessionItem key={session.id} session={session} active={session.id === activeId} onDelete={() => setDeleting(session)} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.bottom}>
        <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
          <span className={styles.settingsIcon}><IconSettingsOutline16 /></span>
          <span className={styles.settingsLabel}>{t('settings')}</span>
        </button>
      </div>
      <AccountPanel />
      {folderDialog ? <Modal
        title={folderDialog.type === 'create' ? '新建分类' : folderDialog.type === 'rename' ? '重命名分类' : '删除分类'}
        closable
        onClose={() => !folderBusy && setFolderDialog(null)}
        footer={<><Button variant="outlined" disabled={folderBusy} onClick={() => setFolderDialog(null)}>取消</Button><Button variant={folderDialog.type === 'delete' ? 'danger' : 'primary'} disabled={folderBusy} onClick={() => void submitFolder()}>{folderDialog.type === 'delete' ? '删除' : '保存'}</Button></>}
      >
        {folderDialog.type === 'delete'
          ? `删除分类「${folderDialog.folder.name}」？对话会保留并移动到未分类。`
          : <div className={styles.folderForm}><label>分类名称<input autoFocus maxLength={40} value={folderName} onChange={(event) => setFolderName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void submitFolder()} /></label></div>}
      </Modal> : null}
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {setDeleting(null)}
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>{t('cancel')}</Button>
              <Button variant="danger" disabled={deletePending} onClick={async () => {
                setDeletePending(true)
                try {
                  if (await removeSession(deleting.id)) {setDeleting(null)}
                  else {showToast({ key: 'sessionDeleteFailed', type: 'error' })}
                } finally { setDeletePending(false) }
              }}>{t('delete')}</Button>
            </>
          }
        >{t('deleteSessionWithFilesDescription')}</Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  if (!open) {return null}
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}><Sider mobile /></div>
    </>
  )
}
