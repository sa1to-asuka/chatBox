import type { FastifyReply, FastifyRequest } from 'fastify'

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'request_error') {
    super(message)
  }
}
export const requireString = (value: unknown, name: string, max: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new HttpError(400, `${name}格式不正确`)
  }
  return value.trim()
}
export const body = (request: FastifyRequest): Record<string, unknown> => {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    throw new HttpError(400, '请求格式不正确')
  }
  return request.body as Record<string, unknown>
}
export const sendError = (reply: FastifyReply, error: unknown) => {
  if (error instanceof HttpError) {
    return reply.code(error.status).send({ error: error.message, code: error.code })
  }
  requestSafeLog(error)
  return reply.code(500).send({ error: '服务暂时不可用，请稍后重试', code: 'internal_error' })
}
const requestSafeLog = (error: unknown) => {
  if (process.env.NODE_ENV !== 'test') console.error(error instanceof Error ? error.message : 'Request failed')
}
export const cleanText = (value: string, max: number): string =>
  [...value.replaceAll('\0', '').trim()].slice(0, max).join('')
