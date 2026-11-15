import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { IconCloseOutline16, IconFolderOutline16 } from '../base/icons.js'
import { setActiveFolder, useFolders } from '../../services/chat/folders.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 新对话：问候语 + 输入框。桌面端居中；移动端输入框吸底 */
export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const activeFolder = useFolders((state) => state.folders.find((folder) => folder.id === state.activeFolderId))
  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        {activeFolder ? <div className={styles.folderContext}>
          <IconFolderOutline16 /><span>新对话将创建在「{activeFolder.name}」</span>
          <button type="button" aria-label="取消分类选择" onClick={() => setActiveFolder(null)}><IconCloseOutline16 /></button>
        </div> : null}
        <div className={styles.greeting}>{t('welcomeMessageChat250808')}</div>
        <ChatInput sessionId={null} />
        {isMobile ? <div className={styles.caveat}>{t('contentCaveat')}</div> : null}
      </div>
    </div>
  )
}
