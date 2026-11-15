import { useSyncExternalStore } from 'react'

const event = 'chatbox:navigate'
const subscribe = (listener: () => void) => {
  window.addEventListener('popstate', listener)
  window.addEventListener(event, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(event, listener)
  }
}

export const usePathname = () => useSyncExternalStore(subscribe, () => window.location.pathname, () => '/')

export const navigate = (path: string, replace = false) => {
  if (window.location.pathname === path) {return}
  if (replace) {window.history.replaceState(null, '', path)}
  else {window.history.pushState(null, '', path)}
  window.dispatchEvent(new Event(event))
}
