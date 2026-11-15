import { cleanText, HttpError, requireString } from './http.js'

export const username = (value: unknown): string => {
  const name = requireString(value, '用户名', 32)
  if (!/^[\p{L}\p{N}_.-]+$/u.test(name)) {
    throw new HttpError(400, '用户名只能包含文字、字母、数字及 _ . -')
  }
  return name
}

export const password = (value: unknown): string => {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new HttpError(400, '密码长度应为 8 至 128 个字符')
  }
  return value
}

export const displayName = (value: unknown, fallback: string): string =>
  cleanText(requireString(value ?? fallback, '显示名称', 40), 40)
