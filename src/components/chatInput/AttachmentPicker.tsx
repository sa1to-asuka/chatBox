import { useRef, useState } from 'react'
import { useIsMobile } from '../../app/viewport.js'
import { ACCEPT } from '../../services/attachments.js'
import { IconBrowseOutline16, IconPhotoOutline16, IconPlusOutline16 } from '../base/icons.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import styles from './AttachmentPicker.module.css'

export const AttachmentPicker = ({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled: boolean }) => {
  const isMobile = useIsMobile()
  const imageInput = useRef<HTMLInputElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const takeFiles = (files: FileList | null) => {
    const selected = Array.from(files ?? [])
    if (selected.length) {onFiles(selected)}
  }
  const choose = (kind: 'image' | 'file') => {
    setSheetOpen(false)
    if (kind === 'image') {imageInput.current?.click()}
    else {fileInput.current?.click()}
  }
  const options = [
    { key: 'image', label: '选择图片', icon: <IconPhotoOutline16 />, onSelect: () => choose('image') },
    { key: 'file', label: '选择文件', icon: <IconBrowseOutline16 />, onSelect: () => choose('file') },
  ]
  return <>
    {isMobile ? (
      <IconButton
        size="m"
        tone="primary"
        icon={<IconPlusOutline16 />}
        aria-label="添加图片或文件"
        disabled={disabled}
        onClick={() => setSheetOpen(true)}
      />
    ) : (
      <Menu options={options}>
        {({ toggle }) => (
          <IconButton
            size="m"
            tone="primary"
            icon={<IconPlusOutline16 />}
            tooltip="添加图片或文件"
            disabled={disabled}
            onClick={toggle}
          />
        )}
      </Menu>
    )}
    <input
      ref={imageInput}
      className={styles.hidden}
      type="file"
      multiple
      accept="image/jpeg,image/png,image/gif,image/webp"
      onChange={(event) => {
        takeFiles(event.target.files)
        event.target.value = ''
      }}
    />
    <input
      ref={fileInput}
      className={styles.hidden}
      type="file"
      multiple
      accept={ACCEPT}
      onChange={(event) => {
        takeFiles(event.target.files)
        event.target.value = ''
      }}
    />
    {sheetOpen ? <div className={styles.overlay} onClick={() => setSheetOpen(false)}>
      <div className={styles.sheet} role="dialog" aria-label="添加附件" onClick={(event) => event.stopPropagation()}>
        <div className={styles.handle} />
        <p className={styles.title}>添加附件</p>
        <button type="button" onClick={() => choose('image')}>
          <span className={styles.icon}><IconPhotoOutline16 /></span>
          <span><strong>选择图片</strong><small>支持一次选择多张，可继续添加</small></span>
        </button>
        <button type="button" onClick={() => choose('file')}>
          <span className={styles.icon}><IconBrowseOutline16 /></span>
          <span><strong>选择文件</strong><small>文档、代码、PDF 和 DOCX，可多选</small></span>
        </button>
        <button type="button" className={styles.cancel} onClick={() => setSheetOpen(false)}>取消</button>
      </div>
    </div> : null}
  </>
}
