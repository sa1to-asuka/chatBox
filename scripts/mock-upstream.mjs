import { createServer } from 'node:http'

const port = Number(process.env.MOCK_PORT ?? 3901)
createServer((request, response) => {
  if (request.url === '/v1/models') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      object: 'list',
      data: [
        { id: 'mock-standard', object: 'model', created: 1, owned_by: 'local' },
        { id: 'mock-advanced', object: 'model', created: 1, owned_by: 'local' },
      ],
    }))
    return
  }
  if (request.url === '/v1/chat/completions') {
    let body = ''
    request.on('data', (chunk) => { body += chunk })
    request.on('end', () => {
      const payload = JSON.parse(body)
      const messages = payload.messages ?? []
      const lastUser = [...messages].reverse().find((message) => message.role === 'user')
      const userText = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '')
      const askedForSvg = userText.toLowerCase().includes('svg')
      const askedForReasoning = userText.includes('思维链')
      const askedForXlsx = userText.includes('生成表格')
      const askedForDocx = userText.includes('生成文档')
      const askedForPptx = userText.includes('生成演示')
      const askedForMermaid = /流程图|思维导图|mermaid/i.test(userText)
      const askedForHtml = /html/i.test(userText)
      if (!payload.stream) {
        response.writeHead(400)
        response.end()
        return
      }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const send = (delta, finish = null, usage) => response.write(`data: ${JSON.stringify({
        id: 'mock', object: 'chat.completion.chunk', created: Date.now(), model: payload.model,
        choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}),
      })}\n\n`)
      const systemMessage = messages.find((message) => message.role === 'system')
      const systemText = typeof systemMessage?.content === 'string' ? systemMessage.content : ''
      const pptxDeck = {
        title: '2026 年度复盘',
        subtitle: '增长、效率与下一步',
        slides: [
          { layout: 'title', title: '2026 年度复盘', subtitle: '增长、效率与下一步', notes: '开场：用三个关键词概括今年。' },
          { layout: 'section', number: '01', title: '核心结论', subtitle: '先看三件最重要的事' },
          { layout: 'kpis', title: '关键指标', kpis: [{ value: '18%', label: '营收增长' }, { value: '4pt', label: '留存提升' }, { value: '2.1x', label: '效率提升' }], notes: '强调增长质量。' },
          { layout: 'bullets', kicker: 'WHAT WORKED', title: '三件做对的事', bullets: ['产品体验：减少关键路径步骤', '增长：内容与口碑带来自然流量', '组织：小团队快速闭环'], notes: '每点展开一个例子。' },
          { layout: 'chart', title: '季度营收趋势', chart: [{ label: 'Q1', value: 42 }, { label: 'Q2', value: 51 }, { label: 'Q3', value: 63 }, { label: 'Q4', value: 78 }], notes: '解释 Q4 的加速。' },
          { layout: 'table', title: '问题与对策', table: { headers: ['问题', '影响', '对策'], rows: [['获客成本上升', '利润承压', '优化渠道结构'], ['交付周期偏长', '体验下降', '拆分关键流程'], ['知识沉淀不足', '重复踩坑', '建立复盘机制']] }, notes: '挑一个重点展开。' },
          { layout: 'quote', quote: '把复杂留给自己，把简单留给用户。', author: '产品团队', notes: '过渡到下一步。' },
          { layout: 'closing', title: '谢谢', subtitle: '2026，一起把事做成。' },
        ],
      }
      const toolCount = messages.filter((message) => message.role === 'tool').length
      const agentSearch = /联网测试|搜索测试|search test/i.test(userText)
      const agentPpt = /(做一个|帮我做|生成).{0,8}ppt|PPT测试|ppt test/i.test(userText)
      if (agentSearch || agentPpt) {
        if (toolCount === 0) {
          send({
            role: 'assistant',
            tool_calls: [{
              index: 0,
              id: 'call_search_1',
              type: 'function',
              function: { name: 'web_search', arguments: JSON.stringify({ query: '人工智能 最新进展 2026' }) },
            }],
          })
          send({}, 'tool_calls', { prompt_tokens: 120, completion_tokens: 20, total_tokens: 140 })
          response.end('data: [DONE]\n\n')
          return
        }
        if (agentPpt && toolCount === 1) {
          send({
            role: 'assistant',
            tool_calls: [{
              index: 0,
              id: 'call_file_1',
              type: 'function',
              function: {
                name: 'create_file',
                arguments: JSON.stringify({
                  format: 'pptx',
                  title: '联网测试演示',
                  content: JSON.stringify(pptxDeck),
                }),
              },
            }],
          })
          send({}, 'tool_calls', { prompt_tokens: 180, completion_tokens: 120, total_tokens: 300 })
          response.end('data: [DONE]\n\n')
          return
        }
        send({ role: 'assistant', content: agentPpt
          ? '已完成联网检索并生成演示文稿，文件已保存到文件管理，可在下方卡片或账户 → 文件管理下载。'
          : '已完成联网检索：2026 年 AI 行业仍在快速变化，以下结论基于刚才检索到的来源。' })
        send({}, 'stop', { prompt_tokens: 220, completion_tokens: 48, total_tokens: 268 })
        response.end('data: [DONE]\n\n')
        return
      }
      if (systemText.includes('文档处理 Agent')) {
        const format = /目标格式：(docx|xlsx|pptx|pdf)/.exec(systemText)?.[1] ?? 'docx'
        const content = format === 'xlsx'
          ? '名称,数量,备注\n示例,1,本地测试'
          : format === 'pptx'
            ? JSON.stringify(pptxDeck)
            : '# 本地测试文档\n\n这是工作台生成的摘要内容。\n\n- 第一点\n- 第二点'
        send({
          role: 'assistant',
          content: JSON.stringify({ plan: ['读取文件', '整理内容', '生成文件'], title: '本地测试文档', content }),
        })
        send({}, 'stop', { prompt_tokens: 42, completion_tokens: 24, total_tokens: 66 })
        response.end('data: [DONE]\n\n')
        return
      }
      if (askedForMermaid || askedForHtml || askedForXlsx || askedForDocx || askedForPptx) {
        const content = askedForMermaid
          ? '```mermaid\nmindmap\n  root((项目))\n    规划\n      需求\n      里程碑\n    执行\n      开发\n      测试\n```'
          : askedForHtml
            ? '```html\n<div style="font-family:sans-serif;padding:24px;background:#f7f9f6"><h2 style="color:#173b2b;margin:0 0 16px">季度目标</h2><div style="display:flex;gap:12px"><div style="flex:1;padding:16px;border-radius:12px;background:#e8eee7">营收 +18%</div><div style="flex:1;padding:16px;border-radius:12px;background:#e8eee7">留存 +4pt</div></div></div>\n```'
            : askedForXlsx
              ? '```xlsx filename="测试表格.xlsx" sheet="数据"\n名称,数量,备注\n苹果,3,"含,逗号"\n香蕉,5,\n```'
              : askedForDocx
                ? '```docx filename="测试文档.docx"\n# 测试文档\n\n这是一个用于验证下载的段落。\n\n## 要点\n\n- 第一点\n- 第二点\n\n| 模块 | 状态 |\n| --- | --- |\n| 登录 | 完成 |\n```'
                : `\`\`\`pptx filename="测试演示.pptx"\n${JSON.stringify(pptxDeck)}\n\`\`\``
        send({ role: 'assistant', content })
        send({}, 'stop', { prompt_tokens: 42, completion_tokens: 24, total_tokens: 66 })
        response.end('data: [DONE]\n\n')
        return
      }
      if (askedForReasoning) {
        send({ reasoning_content: '我先梳理一下问题：\n\n1. 理解需求\n2. 组织回答。' })
      }
      send({ role: 'assistant', content: askedForSvg ? '这是一个可播放的 SVG 动画：\n\n```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 140" width="480" height="280">\n  <style>circle{animation:pulse 1.2s ease-in-out infinite alternate}@keyframes pulse{to{fill:#8fc3a3;r:34}}</style>\n  <rect width="240" height="140" rx="18" fill="#f4f8f3"/>\n  <circle cx="120" cy="70" r="22" fill="#2b5d45"/>\n  <script>document.body.dataset.animation = "running"</script>\n</svg>\n```' : '这是本地模拟回复。' })
      send({ content: askedForSvg ? '' : '\n\n界面与流式输出工作正常，**没有调用真实模型**。' })
      send({}, 'stop', { prompt_tokens: 42, completion_tokens: 24, total_tokens: 66 })
      response.end('data: [DONE]\n\n')
    })
    return
  }
  response.writeHead(404)
  response.end()
}).listen(port, '127.0.0.1', () => console.log(`Mock OpenAI endpoint: http://127.0.0.1:${port}/v1`))
