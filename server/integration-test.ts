import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { strToU8, zipSync } from 'fflate'
import { db } from './db.js'
import { hashPassword } from './auth.js'

let lastMessages: { role: string; content: unknown }[] = []
let lastWebSearch = false
const upstream = createServer((request, response) => {
  if (request.url === '/v1/models') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      object: 'list',
      data: [
        { id: 'mock-standard', object: 'model', created: 1, owned_by: 'test' },
        { id: 'mock-advanced', object: 'model', created: 1, owned_by: 'test' },
      ],
    }))
    return
  }
  if (request.url === '/v1/chat/completions') {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const payload = JSON.parse(body) as { stream?: boolean; messages?: { role: string; content: unknown }[]; web_search_options?: unknown }
      lastMessages = payload.messages ?? []
      lastWebSearch = Boolean(payload.web_search_options)
      if (!payload.stream) {
        response.writeHead(400)
        response.end()
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const chunk = (delta: object, finish: string | null = null, usage?: object) => response.write(
        `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 1, model: 'mock-standard', choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`
      )
      chunk({ role: 'assistant', content: '你好，' })
      chunk(lastWebSearch ? { content: '本地测试成功。', annotations: [{ type: 'url_citation', url_citation: { url: 'https://example.com/source', title: '测试来源' } }] } : { content: '本地测试成功。' })
      chunk({}, 'stop', { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 })
      response.end('data: [DONE]\n\n')
    })
    return
  }
  response.writeHead(404)
  response.end()
})

const minimalPdf = () => {
  const streamText = 'BT /F1 24 Tf 72 720 Td (Hello PDF) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${streamText.length} >>\nstream\n${streamText}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return pdf
}

const minimalDocx = () => zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
  'word/document.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX test content</w:t></w:r></w:p></w:body></w:document>'),
})

await new Promise<void>((resolve) => upstream.listen(3902, '127.0.0.1', resolve))
const { buildApp } = await import('./index.js')
const app = await buildApp()
const base = 'http://127.0.0.1:3007'
const cookie: Record<string, string> = { user: '', admin: '', other: '', unlimited: '' }

const request = (path: string, options: RequestInit = {}, account = 'user') => {
  const form = options.body instanceof FormData
  return fetch(base + path, {
    ...options,
    headers: {
      ...(options.body && !form ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie[account] ? { cookie: cookie[account] } : {}),
      ...options.headers,
    },
  })
}
const inspect = async (response: Response) => {
  const type = response.headers.get('content-type') ?? ''
  return type.includes('json') ? await response.json() : await response.text()
}
const call = async (path: string, options: RequestInit = {}, account = 'user') => {
  const response = await request(path, options, account)
  const setCookie = response.headers.get('set-cookie')
  if (setCookie) cookie[account] = setCookie.split(';')[0]
  const data = await inspect(response)
  if (!response.ok) throw new Error(`${path} ${response.status}: ${JSON.stringify(data)}`)
  return data
}
const expectStatus = async (status: number, path: string, options: RequestInit = {}, account = 'user') => {
  const response = await request(path, options, account)
  if (response.status !== status) throw new Error(`${path} expected ${status}, got ${response.status}: ${await response.text()}`)
}
const upload = async (name: string, type: string, data: Uint8Array | string) => {
  const form = new FormData()
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  form.append('file', new Blob([copy.buffer], { type }), name)
  return await call('/api/files', { method: 'POST', body: form }) as { id: string; isImage: boolean }
}
const chat = (sessionId: string, modelId: string, prompt: string, extras: object = {}, account = 'user') => call('/api/chat/stream', {
  method: 'POST',
  body: JSON.stringify({ sessionId, requestId: randomUUID(), modelId, prompt, attachmentIds: [], thinking: false, ...extras }),
}, account) as Promise<string>

try {
  await app.listen({ host: '127.0.0.1', port: 3007 })
  db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,0,0,?)').run('admin-id', 'admin', '管理员', hashPassword('testing-password'), 'admin', null, Date.now())
  await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'testing-password' }) }, 'admin')
  await call('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'tester', displayName: '测试用户', password: 'testing-password' }) })
  await call('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'other', displayName: '其他用户', password: 'testing-password' }) }, 'other')
  await expectStatus(401, '/api/models', {}, '')
  const anonymous = await call('/api/auth/me', {}, '') as { user: unknown }
  if (anonymous.user !== null) throw new Error('未登录会话应返回空用户')

  const createdUser = await call('/api/admin/users', {
    method: 'POST', body: JSON.stringify({ username: 'newuser', displayName: '新用户', password: 'new-user-password', role: 'vip' }),
  }, 'admin') as { user: { username: string; role: string } }
  if (createdUser.user.username !== 'newuser' || createdUser.user.role !== 'vip') throw new Error('管理员创建用户失败')
  await call('/api/admin/overview', {}, 'admin')
  await expectStatus(403, '/api/admin/users', { method: 'POST', body: JSON.stringify({ username: 'blocked', displayName: 'x', password: 'password123' }) })
  await expectStatus(409, '/api/admin/users', { method: 'POST', body: JSON.stringify({ username: 'newuser', displayName: 'x', password: 'password123' }) }, 'admin')
  await call('/api/admin/providers', { method: 'POST', body: JSON.stringify({ name: '本地模拟', type: 'openai', baseUrl: 'http://127.0.0.1:3902/v1', apiKey: 'mock-key' }) }, 'admin')
  const provider = (await call('/api/admin/providers', {}, 'admin') as { providers: { id: string }[] }).providers[0]
  const discovered = await call(`/api/admin/providers/${provider.id}/discover`, { method: 'POST' }, 'admin') as { models: { id: string; name: string }[] }
  await call(`/api/admin/providers/${provider.id}/import`, { method: 'POST', body: JSON.stringify({ models: discovered.models }) }, 'admin')
  const models = (await call('/api/admin/models', {}, 'admin') as { models: { id: string; upstreamId: string }[] }).models
  for (const model of models) {
    await call(`/api/admin/models/${model.id}`, { method: 'PATCH', body: JSON.stringify({ premium: model.upstreamId === 'mock-advanced' }) }, 'admin')
  }
  const visible = await call('/api/models') as { models: { id: string; premium: boolean }[] }
  if (visible.models.length !== 1 || visible.models[0].premium) throw new Error('普通用户模型隔离失败')
  const advanced = models.find((model) => model.upstreamId === 'mock-advanced')!
  await expectStatus(403, '/api/chat/stream', { method: 'POST', body: JSON.stringify({ sessionId: 'blocked-chat', requestId: randomUUID(), modelId: advanced.id, prompt: '越权', attachmentIds: [], thinking: false }) })
  await expectStatus(403, '/api/admin/overview')

  const firstRequest = randomUUID()
  const stream = await call('/api/chat/stream', { method: 'POST', body: JSON.stringify({
    sessionId: 'test-chat', requestId: firstRequest, modelId: visible.models[0].id, prompt: '你好', attachmentIds: [], thinking: false,
    history: [{ role: 'user', content: '上一轮问题' }, { role: 'assistant', content: '上一轮回答' }],
  }) }) as string
  if (!stream.includes('本地测试成功')) throw new Error('流式响应失败')
  if (lastMessages.length !== 3 || lastMessages[1]?.content !== '上一轮回答') throw new Error('聊天上下文处理错误')
  const me = await call('/api/auth/me') as { user: { id: string; quotaUsed: number } }
  if (me.user.quotaUsed !== 28) throw new Error(`积分结算错误：${me.user.quotaUsed}`)
  const saved = await call('/api/chats/test-chat', { method: 'PUT', body: JSON.stringify({ revision: 0, title: '同步测试', rootMessageId: 'm1', messages: [{ id: 'm1', role: 'user', content: '你好', files: [], createdAt: Date.now() }] }) }) as { revision: number }
  if (saved.revision !== 1) throw new Error('首次会话同步失败')
  await expectStatus(409, '/api/chats/test-chat', { method: 'PUT', body: JSON.stringify({ revision: 0, title: '旧版本', messages: [] }) })
  const loaded = await call('/api/chats/test-chat') as { session: { title: string; messages: unknown[] } }
  if (loaded.session.title !== '同步测试' || loaded.session.messages.length !== 1) throw new Error('会话回读失败')
  await expectStatus(409, '/api/chat/stream', { method: 'POST', body: JSON.stringify({ sessionId: 'test-chat', requestId: firstRequest, modelId: visible.models[0].id, prompt: '重复', attachmentIds: [], thinking: false }) })

  const textFile = await upload('note.txt', 'text/plain', 'TXT test content')
  await expectStatus(404, `/api/files/${textFile.id}`, {}, 'other')
  await expectStatus(404, `/api/files/${textFile.id}`, {}, 'admin')
  await expectStatus(404, '/api/chats/test-chat', {}, 'admin')
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
  const image = await upload('pixel.png', 'image/png', png)
  await expectStatus(400, '/api/chat/stream', { method: 'POST', body: JSON.stringify({ sessionId: 'test-chat', requestId: randomUUID(), modelId: visible.models[0].id, prompt: '看图', attachmentIds: [image.id], thinking: false }) })
  await call(`/api/admin/models/${visible.models[0].id}`, { method: 'PATCH', body: JSON.stringify({ capabilities: { vision: true, files: true, thinking: false } }) }, 'admin')
  const imageStream = await chat('test-chat', visible.models[0].id, '看图', { attachmentIds: [image.id], history: [] })
  if (!imageStream.includes('本地测试成功')) throw new Error('图片上下文请求失败')

  const pdf = await upload('sample.pdf', 'application/pdf', minimalPdf())
  const docxFile = await upload('sample.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', minimalDocx())
  const docStream = await chat('test-chat', visible.models[0].id, '总结文档', { attachmentIds: [pdf.id, docxFile.id, textFile.id], history: [] })
  if (!docStream.includes('本地测试成功')) throw new Error('PDF/DOCX 文本提取失败')

  const standardId = visible.models[0].id
  await expectStatus(400, `/api/admin/models/${standardId}`, { method: 'PATCH', body: JSON.stringify({ searchMode: 'anthropic' }) }, 'admin')
  await call(`/api/admin/models/${standardId}`, { method: 'PATCH', body: JSON.stringify({ searchMode: 'openai' }) }, 'admin')
  const searchStream = await chat('test-chat', standardId, '搜索测试', { history: [], search: true })
  if (!lastWebSearch || !searchStream.includes('citations_delta') || !searchStream.includes('https://example.com/source')) {
    throw new Error('OpenAI 原生搜索请求或引用未生效')
  }
  const noSearchStream = await chat('test-chat', standardId, '不搜索', { history: [], search: false })
  if (lastWebSearch || !noSearchStream.includes('本地测试成功')) throw new Error('关闭搜索后仍发送 web_search_options')

  const richSession = {
    revision: 1, title: '搜索与分享测试', rootMessageId: 'u1',
    messages: [
      { id: 'u1', role: 'user', content: '你好深蓝关键词', parentId: null, selectedChildId: 'a1', files: [{ id: image.id, serverId: image.id, name: 'pixel.png', size: 100, isImage: true, mimeType: 'image/png' }], createdAt: Date.now() - 1000 },
      { id: 'a1', role: 'assistant', parentId: 'u1', status: 'done', stopReason: 'end_turn', prefix: true, blocks: [{ type: 'text', text: '本地回答 深蓝关键词', citations: [{ type: 'web_search_result_location', url: 'https://example.com/source', title: '测试来源', cited_text: '', encrypted_index: '' }] }], createdAt: Date.now() },
    ],
  }
  await call('/api/chats/test-chat', { method: 'PUT', body: JSON.stringify(richSession) })
  const pinned = await call('/api/chats/test-chat/meta', { method: 'PATCH', body: JSON.stringify({ pinned: true }) }) as { pinned: boolean }
  if (!pinned.pinned) throw new Error('置顶失败')
  const afterPin = await call('/api/chats/test-chat') as { session: { revision: number } }
  if (afterPin.session.revision !== 2) throw new Error('元数据错误改动了 revision')
  const chats = await call('/api/chats') as { sessions: { id: string; pinned: boolean; folderId: string | null }[] }
  if (!chats.sessions.find((item) => item.id === 'test-chat')?.pinned) throw new Error('会话列表未返回置顶状态')
  const folder = await call('/api/folders', { method: 'POST', body: JSON.stringify({ name: '项目资料' }) }) as { id: string }
  await call('/api/chats/test-chat/meta', { method: 'PATCH', body: JSON.stringify({ folderId: folder.id }) })
  const folderList = await call('/api/folders') as { folders: { id: string; sessionCount: number }[] }
  if (folderList.folders.find((item) => item.id === folder.id)?.sessionCount !== 1) throw new Error('文件夹计数错误')
  const search = await call('/api/search?q=' + encodeURIComponent('深蓝关键词')) as { results: { id: string; matches: { snippet: string }[] }[] }
  if (!search.results.some((item) => item.id === 'test-chat' && item.matches[0]?.snippet.includes('深蓝关键词'))) throw new Error('跨会话消息搜索失败')
  const otherSearch = await call('/api/search?q=' + encodeURIComponent('深蓝关键词'), {}, 'other') as { results: unknown[] }
  if (otherSearch.results.length !== 0) throw new Error('搜索泄漏其他用户数据')
  await call(`/api/folders/${folder.id}`, { method: 'DELETE' })
  const afterFolder = await call('/api/chats') as { sessions: { id: string; folderId: string | null }[] }
  if (afterFolder.sessions.find((item) => item.id === 'test-chat')?.folderId !== null) throw new Error('删除文件夹未移出会话')
  const category = await call('/api/folders', { method: 'POST', body: JSON.stringify({ name: '分类内新建' }) }, 'admin') as { id: string }
  await call('/api/chats/folder-save', { method: 'PUT', body: JSON.stringify({
    revision: 0, title: '分类会话', rootMessageId: null, folderId: category.id,
    messages: [{ id: 'f1', role: 'user', content: '分类消息', files: [], createdAt: Date.now() }],
  }) }, 'admin')
  let folderChat = await call('/api/chats', {}, 'admin') as { sessions: { id: string; folderId: string | null }[] }
  if (folderChat.sessions.find((item) => item.id === 'folder-save')?.folderId !== category.id) throw new Error('首次保存未写入分类')
  await call('/api/chats/folder-save', { method: 'PUT', body: JSON.stringify({
    revision: 1, title: '分类会话 2', rootMessageId: null,
    messages: [{ id: 'f1', role: 'user', content: '分类消息 2', files: [], createdAt: Date.now() }],
  }) }, 'admin')
  folderChat = await call('/api/chats', {}, 'admin') as { sessions: { id: string; folderId: string | null }[] }
  if (folderChat.sessions.find((item) => item.id === 'folder-save')?.folderId !== category.id) throw new Error('后续保存覆盖了分类')

  const usage = await call('/api/usage/me') as { today: { used: number; remaining: number }; recent: { searchRequests: number }[]; byModel: unknown[] }
  if (usage.today.used <= 0 || usage.byModel.length === 0) throw new Error('用户用量数据不完整')
  const otherUsage = await call('/api/usage/me', {}, 'other') as { recent: unknown[] }
  if (otherUsage.recent.length !== 0) throw new Error('用量未按用户隔离')

  const share = await call('/api/chats/test-chat/shares', { method: 'POST' }) as { id: string; token: string }
  const publicShare = await request(`/api/share/${share.token}`, {}, '')
  const publicBody = await publicShare.json() as { snapshot: { messages: { role: string; content: string }[] }; title: string }
  if (publicShare.status !== 200 || !publicBody.snapshot.messages.some((item) => item.content.includes('深蓝关键词'))) throw new Error('公开分享读取失败')
  if (!String(publicShare.headers.get('x-robots-tag')).includes('noindex')) throw new Error('分享页缺少 noindex')
  const sharedImage = await request(`/api/share/${share.token}/files/${image.id}`, {}, '')
  if (sharedImage.status !== 200) throw new Error('分享图片读取失败')
  const sharedText = await request(`/api/share/${share.token}/files/${textFile.id}`, {}, '')
  if (sharedText.status !== 404) throw new Error('分享接口暴露了非图片附件')
  const sharedPreview = await call(`/api/share/${share.token}/svg-preview`, { method: 'POST', body: JSON.stringify({ code: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>' }) }, '') as { url: string }
  if (!sharedPreview.url) throw new Error('分享页 SVG 预览失败')
  await call(`/api/shares/${share.id}`, { method: 'DELETE' })
  await expectStatus(404, `/api/share/${share.token}`, {}, '')
  await expectStatus(404, `/api/share/${share.token}/svg-preview`, { method: 'POST', body: JSON.stringify({ code: '<svg/>' }) }, '')

  const exported = await request('/api/chats/test-chat/export?format=md')
  const markdown = await exported.text()
  if (exported.status !== 200 || !markdown.includes('深蓝关键词') || !markdown.includes('https://example.com/source')) throw new Error('Markdown 导出失败')
  const exportedJson = await call('/api/chats/test-chat/export?format=json') as { messages: unknown[] }
  if (exportedJson.messages.length !== 2) throw new Error('JSON 导出失败')

  const svg = await call('/api/svg-preview', { method: 'POST', body: JSON.stringify({ code: '<svg xmlns="http://www.w3.org/2000/svg"><script>document.body.dataset.ran="1"</script><circle r="10"/></svg>' }) }) as { url: string }
  const preview = await fetch(base + svg.url)
  if (preview.status !== 200) throw new Error('SVG 预览读取失败')
  const csp = preview.headers.get('content-security-policy') ?? ''
  if (!csp.includes('sandbox allow-scripts') || !csp.includes("connect-src 'none'") || preview.headers.get('x-frame-options') !== 'SAMEORIGIN') throw new Error('SVG 预览安全头不完整')
  await expectStatus(400, '/api/svg-preview', { method: 'POST', body: JSON.stringify({ code: 'x'.repeat(262145) }) })
  const svgAfterShareRevoked = await fetch(base + sharedPreview.url)
  if (svgAfterShareRevoked.status !== 200) throw new Error('已创建的沙箱预览被意外删除')

  await call('/api/admin/users', { method: 'POST', body: JSON.stringify({
    username: 'unlimited', displayName: '不限量用户', password: 'unlimited-password', role: 'user', unlimited: true,
  }) }, 'admin')
  await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'unlimited', password: 'unlimited-password' }) }, 'unlimited')
  await chat('unlimited-chat', standardId, '不限量测试', { history: [] }, 'unlimited')
  const unlimitedMe = await call('/api/auth/me', {}, 'unlimited') as { user: { quotaUsed: number; unlimited: boolean } }
  if (!unlimitedMe.user.unlimited || unlimitedMe.user.quotaUsed <= 0) throw new Error('不限量用户已用积分未统计')
  const unlimitedUsage = await call('/api/usage/me', {}, 'unlimited') as { today: { used: number; remaining: number | null; unlimited: boolean } }
  if (!unlimitedUsage.today.unlimited || unlimitedUsage.today.used <= 0 || unlimitedUsage.today.remaining !== null) throw new Error('不限量用户用量页数据错误')
  const evil = await fetch(base + '/api/chats', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookie.user, origin: 'https://evil.example' }, body: JSON.stringify({ id: 'evil' }) })
  if (evil.status !== 403) throw new Error(`恶意 Origin 未拦截：${evil.status}`)
  await call('/api/chats/test-chat')

  const before = (await call('/api/auth/me') as { user: { quotaUsed: number } }).user.quotaUsed
  await call(`/api/admin/users/${me.user.id}`, { method: 'PATCH', body: JSON.stringify({ dailyQuota: before + 1 }) }, 'admin')
  await expectStatus(429, '/api/chat/stream', { method: 'POST', body: JSON.stringify({ sessionId: 'test-chat', requestId: randomUUID(), modelId: visible.models[0].id, prompt: '额度不足', attachmentIds: [], thinking: false }) })
  await call(`/api/admin/users/${me.user.id}`, { method: 'PATCH', body: JSON.stringify({ role: 'vip', dailyQuota: null }) }, 'admin')
  const loggedOut = await call('/api/auth/me') as { user: unknown }
  if (loggedOut.user !== null) throw new Error('角色变化后旧会话未失效')
  await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'tester', password: 'testing-password' }) })
  const vipModels = await call('/api/models') as { models: { id: string; premium: boolean }[] }
  if (vipModels.models.length !== 2) throw new Error('VIP 未获得高级模型')
  const vipStream = await chat('test-chat', advanced.id, '高级模型', { history: [] })
  if (!vipStream.includes('本地测试成功')) throw new Error('VIP 高级模型请求失败')
  const meResponse = await fetch(base + '/api/auth/me', { headers: { cookie: cookie.user } })
  const renewed = meResponse.headers.get('set-cookie') ?? ''
  if (!/Max-Age=7776000/i.test(renewed) || !/Expires=/i.test(renewed)) throw new Error('登录会话未滑动续期')
  await chat('delete-temp', standardId, '待删除', { history: [] })
  await call('/api/chats/delete-temp', { method: 'DELETE' })
  await expectStatus(404, '/api/chats/delete-temp')
  await call('/api/chats', { method: 'DELETE' })
  const emptyChats = await call('/api/chats') as { sessions: unknown[] }
  if (emptyChats.sessions.length !== 0) throw new Error('删除全部历史后仍有会话')
  await expectStatus(400, '/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'new-testing-password' }) })
  await call('/api/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword: 'testing-password', newPassword: 'new-testing-password' }) })
  await expectStatus(401, '/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'tester', password: 'testing-password' }) })
  await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'tester', password: 'new-testing-password' }) })
  console.log('PASS: auth, admin, VIP gating, history, usage/quota, duplicate/idempotency, uploads (text/image/PDF/DOCX), isolation and Origin checks')
} finally {
  await app.close()
  upstream.closeAllConnections()
  upstream.close()
  db.close()
}
// Handles opened by fetch keep-alive sockets would otherwise hold the process open.
process.exit(0)
