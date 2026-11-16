import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { BUILTIN_PLUGINS } from './builtin-plugins.js'
import { DEFAULT_SYSTEM_PROMPT } from './prompts.js'

export const dataDir = path.resolve(process.env.DATA_DIR ?? './data')
mkdirSync(dataDir, { recursive: true })
mkdirSync(path.join(dataDir, 'attachments'), { recursive: true })
export const attachmentDir = path.join(dataDir, 'attachments')
export const db = new Database(process.env.DATABASE_PATH ?? path.join(dataDir, 'chat.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','vip','admin')),
  daily_quota INTEGER, unlimited INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('openai','anthropic')),
  base_url TEXT NOT NULL, api_key_encrypted TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  upstream_id TEXT NOT NULL, display_name TEXT NOT NULL, premium INTEGER NOT NULL DEFAULT 0,
  multiplier REAL NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1,
  capabilities TEXT NOT NULL DEFAULT '{"vision":false,"files":false,"thinking":false,"search":false}',
  search_mode TEXT NOT NULL DEFAULT 'none',
  UNIQUE(provider_id, upstream_id)
);
CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '', root_message_id TEXT, revision INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0, pinned_at INTEGER, folder_id TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id, id)
);
CREATE TABLE IF NOT EXISTS chat_messages (
  user_id TEXT NOT NULL, session_id TEXT NOT NULL, message_id TEXT NOT NULL,
  parent_id TEXT, selected_child_id TEXT, role TEXT NOT NULL,
  data TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, session_id, message_id),
  FOREIGN KEY(user_id, session_id) REFERENCES chat_sessions(user_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, storage_name TEXT NOT NULL, mime_type TEXT NOT NULL,
  size INTEGER NOT NULL, is_image INTEGER NOT NULL, upstream_refs TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_user ON attachments(user_id);
CREATE TABLE IF NOT EXISTS quota_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, day TEXT NOT NULL,
  allowance INTEGER NOT NULL, reserved INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, day)
);
CREATE TABLE IF NOT EXISTS usage_ledger (
  request_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  model_id TEXT NOT NULL, day TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0, multiplier REAL NOT NULL,
  reserved INTEGER NOT NULL, charged INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL, estimated INTEGER NOT NULL DEFAULT 0,
  search_requests INTEGER NOT NULL DEFAULT 0,
  error TEXT, created_at INTEGER NOT NULL, settled_at INTEGER
);
CREATE INDEX IF NOT EXISTS usage_user_day ON usage_ledger(user_id, day);
CREATE TABLE IF NOT EXISTS chat_folders (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, id TEXT NOT NULL,
  name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, id)
);
CREATE INDEX IF NOT EXISTS chat_folders_user_position ON chat_folders(user_id, position);
CREATE TABLE IF NOT EXISTS chat_shares (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL, session_id TEXT NOT NULL,
  title TEXT NOT NULL, snapshot TEXT NOT NULL, attachment_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, revoked_at INTEGER,
  FOREIGN KEY(user_id, session_id) REFERENCES chat_sessions(user_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS chat_shares_user_session ON chat_shares(user_id, session_id);
CREATE UNIQUE INDEX IF NOT EXISTS chat_shares_active ON chat_shares(user_id, session_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY, seed_key TEXT,
  name TEXT NOT NULL, command TEXT NOT NULL UNIQUE COLLATE NOCASE,
  icon TEXT NOT NULL DEFAULT 'sparkles', category TEXT NOT NULL DEFAULT 'general',
  description TEXT NOT NULL DEFAULT '', prompt TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'conversation' CHECK(scope IN ('conversation','message')),
  enabled INTEGER NOT NULL DEFAULT 1, default_enabled INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0, auto INTEGER NOT NULL DEFAULT 0,
  builtin INTEGER NOT NULL DEFAULT 0, prompt_version INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 100, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS plugins_seed_key ON plugins(seed_key) WHERE seed_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS user_plugins (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, plugin_id)
);
CREATE TABLE IF NOT EXISTS workspace_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','done','failed')),
  instruction TEXT NOT NULL,
  model_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_ext TEXT NOT NULL,
  output_format TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT '[]',
  steps TEXT NOT NULL DEFAULT '[]',
  output_name TEXT,
  output_file TEXT,
  output_size INTEGER,
  error TEXT,
  origin TEXT NOT NULL DEFAULT 'upload',
  content TEXT,
  idempotency_key TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS workspace_tasks_user ON workspace_tasks(user_id, created_at);
CREATE INDEX IF NOT EXISTS workspace_tasks_expiry ON workspace_tasks(expires_at);
`)
const addColumn = (table: string, column: string, ddl: string) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
  }
}
addColumn('models', 'search_mode', "TEXT NOT NULL DEFAULT 'none'")
addColumn('chat_sessions', 'pinned', 'INTEGER NOT NULL DEFAULT 0')
addColumn('chat_sessions', 'pinned_at', 'INTEGER')
addColumn('chat_sessions', 'folder_id', 'TEXT')
addColumn('chat_sessions', 'plugin_id', 'TEXT')
addColumn('chat_sessions', 'summary', 'TEXT')
addColumn('chat_sessions', 'compacted_ids', "TEXT NOT NULL DEFAULT '[]'")
addColumn('chat_sessions', 'compacted_at', 'INTEGER')
addColumn('plugins', 'auto', 'INTEGER NOT NULL DEFAULT 0')
addColumn('plugins', 'prompt_version', 'INTEGER NOT NULL DEFAULT 1')
addColumn('workspace_tasks', 'origin', "TEXT NOT NULL DEFAULT 'upload'")
addColumn('workspace_tasks', 'content', 'TEXT')
addColumn('workspace_tasks', 'idempotency_key', 'TEXT')
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS workspace_tasks_idem
  ON workspace_tasks(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`)
addColumn('usage_ledger', 'search_requests', 'INTEGER NOT NULL DEFAULT 0')
db.exec('CREATE INDEX IF NOT EXISTS chat_sessions_pinned ON chat_sessions(user_id, pinned, updated_at)')

db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run('system_prompt', DEFAULT_SYSTEM_PROMPT)
db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run('system_prompt_enabled', '1')
const insertPlugin = db.prepare(`INSERT OR IGNORE INTO plugins
  (id,seed_key,name,command,icon,category,description,prompt,scope,enabled,default_enabled,featured,auto,builtin,prompt_version,sort_order,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,1,?,?,?,1,?,?,?)`)
const syncPlugin = db.prepare(
  'UPDATE plugins SET prompt=?, prompt_version=? WHERE id=? AND builtin=1 AND prompt_version<?'
)
const now = Date.now()
for (const plugin of BUILTIN_PLUGINS) {
  const promptVersion = plugin.promptVersion ?? 1
  insertPlugin.run(plugin.id, plugin.seedKey, plugin.name, plugin.command, plugin.icon, plugin.category,
    plugin.description, plugin.prompt, plugin.scope, plugin.defaultEnabled ? 1 : 0,
    plugin.featured ? 1 : 0, plugin.auto ? 1 : 0, promptVersion, plugin.sortOrder, now)
  syncPlugin.run(plugin.prompt, promptVersion, plugin.id, promptVersion)
}
if (!db.prepare('SELECT value FROM settings WHERE key=?').get('builtin_auto_migrated_v2')) {
  db.prepare("UPDATE plugins SET auto=1 WHERE id='builtin-pptx' AND builtin=1").run()
  db.prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('builtin_auto_migrated_v2','1')").run()
}
export const setting = (key: string, fallback: number): number => {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined
  return row ? Number(row.value) : fallback
}
