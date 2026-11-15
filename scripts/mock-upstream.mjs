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
      const askedForSvg = JSON.stringify(payload.messages ?? []).toLowerCase().includes('svg')
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
