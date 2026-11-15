import Database from 'better-sqlite3'
import { cpSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const dataDir = path.resolve(process.env.DATA_DIR ?? './data')
const target = path.resolve(process.argv[2] ?? './backups', new Date().toISOString().replaceAll(':', '-').slice(0, 19))
mkdirSync(target, { recursive: true })
const db = new Database(path.join(dataDir, 'chat.db'), { readonly: true })
await db.backup(path.join(target, 'chat.db'))
db.close()
cpSync(path.join(dataDir, 'attachments'), path.join(target, 'attachments'), { recursive: true })
console.log(`备份完成：${target}`)
