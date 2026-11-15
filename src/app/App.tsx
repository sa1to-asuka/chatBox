import { useEffect } from 'react'
import { useAuth, refreshUser } from '../services/auth.js'
import { AuthPage } from '../components/auth/AuthPage.js'
import { loadModels, resetModels } from '../services/models.js'
import { loadFolders, resetFolders } from '../services/chat/folders.js'
import { navigate, usePathname } from '../services/navigation.js'
import { AdminPage } from '../components/admin/AdminPage.js'
import { UsagePage } from '../components/usage/UsagePage.js'
import { SharePage } from '../components/share/SharePage.js'
import { useTranslate } from '../i18n/index.js'
import { useSettings } from '../services/settings.js'
import { useIsMobile, useMobileViewport, usePreventPageScroll } from './viewport.js'
import {
  bindChatPersistence,
  initChat,
  resetChat,
  retrySaveSessions,
  selectSession,
  useChatStore,
} from '../services/chat/store.js'
import { SearchPanel } from '../components/search/SearchPanel.js'
import { SessionSearch } from '../components/search/SessionSearch.js'
import { closeGlobalSearch, openGlobalSearch } from '../components/search/globalSearchState.js'
import { closeSearchPanel } from '../components/search/searchPanelState.js'
import { SessionView } from '../components/session/SessionView.js'
import { MobileHeader } from '../components/session/MobileHeader.js'
import { Welcome } from '../components/session/Welcome.js'
import { SettingsDialog } from '../components/settings/SettingsDialog.js'
import { Toast } from '../components/base/Toast.js'
import { showToast } from '../components/base/toastState.js'
import { onUploadNotice } from '../services/attachments.js'
import { Button } from '../components/base/Button.js'
import { stopReadAloud } from '../services/speech/readAloud.js'
import { CollapsedSider } from '../components/sider/CollapsedSider.js'
import { closeMobileSider } from '../components/sider/mobileSiderState.js'
import { MobileSider, Sider } from '../components/sider/Sider.js'
import styles from './App.module.css'

export const App = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  const locale = useSettings((state) => state.locale)
  // 移动端侧边栏以独立抽屉管理开合状态
  const siderCollapsed = useSettings((state) => state.siderCollapsed) && !isMobile
  const ready = useChatStore((state) => state.ready)
  const initError = useChatStore((state) => state.initError)
  const saveError = useChatStore((state) => Object.values(state.sessionSaveErrors).some(Boolean))
  const importingHistory = useChatStore((state) => state.importingHistory)
  const session = useChatStore((state) =>
    state.activeId !== null && Object.hasOwn(state.sessionCache, state.activeId)
      ? state.sessionCache[state.activeId]
      : undefined
  )
  const sessionLoadError = useChatStore((state) =>
    state.activeId === null ? false : state.sessionLoadErrors[state.activeId] === true
  )
  const frameRef = useMobileViewport(isMobile)
  const streaming = useChatStore((state) =>
    state.activeId === null ? false : Object.hasOwn(state.streaming, state.activeId)
  )
  const activeId = useChatStore((state) => state.activeId)
  const auth = useAuth()
  const pathname = usePathname()
  const adminRoute = pathname === '/admin'
  const usageRoute = pathname === '/usage'
  const shareMatch = /^\/s\/([A-Za-z0-9_-]{30,100})$/.exec(pathname)
  const shareRoute = Boolean(shareMatch)

  usePreventPageScroll(isMobile && !adminRoute && !usageRoute && !shareRoute)
  useEffect(() => { void refreshUser() }, [])
  useEffect(() => {
    document.title = shareRoute ? '分享的对话 · Chatbox' : adminRoute ? '管理后台 · Chatbox' : usageRoute ? '积分与用量 · Chatbox' : 'Chatbox'
    if (adminRoute && auth.status === 'authenticated' && auth.user?.role !== 'admin') {navigate('/', true)}
  }, [shareRoute, adminRoute, usageRoute, auth.status, auth.user?.role])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  useEffect(() => {
    if (auth.status !== 'authenticated' || shareRoute || adminRoute || usageRoute) {return}
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openGlobalSearch()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [auth.status, shareRoute, adminRoute, usageRoute])

  // 文件数、存储空间达到上限时，附件上只显示「上传失败」，原因用 toast 说明
  useEffect(() => onUploadNotice(showToast), [])
  useEffect(bindChatPersistence, [])

  // 搜索结果面板只属于当前会话
  useEffect(closeSearchPanel, [activeId])
  // 切换会话时停止朗读
  useEffect(stopReadAloud, [activeId])
  // 移动端选中会话、切换布局后收起抽屉
  useEffect(closeMobileSider, [activeId, isMobile])

  useEffect(() => {
    if (shareRoute) {return}
    if (auth.status === 'authenticated') {
      void initChat()
      void loadModels()
      void loadFolders()
    } else if (auth.status === 'anonymous') {
      resetChat()
      resetModels()
      resetFolders()
      closeGlobalSearch()
    }
  }, [auth.status, shareRoute])
  if (shareMatch) {return <SharePage token={shareMatch[1]} />}
  if (auth.status !== 'authenticated') {return auth.status === 'loading' ? <div className={styles.boot}>正在准备工作空间…</div> : <AuthPage />}
  if (adminRoute) {
    return auth.user?.role === 'admin'
      ? <AdminPage />
      : <div className={styles.boot}>此页面仅管理员可访问，正在返回聊天…</div>
  }
  if (usageRoute) {return <UsagePage />}

  return (
    <>
      <div ref={frameRef} className={styles.frame}>
        {isMobile ? <MobileSider /> : siderCollapsed ? null : <Sider />}
        <main className={styles.main}>
          {saveError ? (
            <div className={styles.saveError} role="alert">
              <span>{t('sessionSaveFailed')}</span>
              <Button
                variant="outlined"
                size="s"
                disabled={importingHistory}
                onClick={retrySaveSessions}
              >
                {t('retry')}
              </Button>
            </div>
          ) : null}
          <div className={styles.content}>
            {siderCollapsed ? <CollapsedSider /> : null}
            {!ready || (activeId !== null && !session) ? (
              <div className={styles.loadingView}>
                {isMobile ? <MobileHeader /> : null}
                <div className={styles.loadingState} role="status" aria-live="polite">
                  <span>
                    {(!ready ? initError : sessionLoadError)
                      ? t(!ready ? 'sessionListLoadFailed' : 'sessionLoadFailed')
                      : t('sessionLoading')}
                  </span>
                  {(!ready ? initError : sessionLoadError) ? (
                    <Button
                      variant="outlined"
                      size="m"
                      onClick={() => {
                        if (!ready) {
                          void initChat()
                        } else if (activeId !== null) {
                          selectSession(activeId)
                        }
                      }}
                    >
                      {t('retry')}
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : session ? (
              <SessionView
                session={session}
                streaming={streaming}
                siderCollapsed={siderCollapsed}
              />
            ) : (
              <Welcome />
            )}
          </div>
        </main>
        <SearchPanel />
      </div>
      <SessionSearch />
      <SettingsDialog />
      <Toast />
    </>
  )
}
