import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseOutline16 } from '../base/icons.js'
import styles from './ImageViewer.module.css'

/** 页内图片查看器：深色遮罩 + 自适应大图，支持关闭按钮、点击遮罩和 Esc。 */
export const ImageViewer = ({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) => {
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      returnFocusRef.current?.focus({ preventScroll: true })
    }
  }, [onClose])

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={(event) => {
        if (event.target === event.currentTarget) {onClose()}
      }}
    >
      <img className={styles.image} src={src} alt={alt} draggable={false} onClick={(event) => event.stopPropagation()} />
      <button ref={closeRef} type="button" className={styles.close} aria-label="关闭图片" onClick={onClose}>
        <IconCloseOutline16 />
      </button>
    </div>,
    document.body
  )
}
