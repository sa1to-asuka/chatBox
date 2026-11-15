import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { db } from './db.js'
import { hashPassword } from './auth.js'

const username = process.argv[2]
const displayName = process.argv[3] ?? '管理员'
const password = process.argv[4]
if (!username || !password || password.length < 12) {
  console.error('用法：pnpm admin:create <用户名> <显示名称> <至少12位密码>')
  process.exit(1)
}
const existing = db.prepare('SELECT COUNT(*) count FROM users WHERE role=?').get('admin') as { count: number }
if (existing.count) {
  console.error('管理员已存在，请登录后在用户管理中修改角色。')
  process.exit(1)
}
db.prepare(`INSERT INTO users(id,username,display_name,password_hash,role,created_at)
  VALUES(?,?,?,?,'admin',?)`).run(randomUUID(), username, displayName, hashPassword(password), Date.now())
console.log('管理员创建成功。请登录后在「管理后台 → 供应商」配置 API。')
db.close()
