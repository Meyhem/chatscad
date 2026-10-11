import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string'
import type { ParamValue } from '../render/types'
import { formatSize } from '../ui/bytes'

export interface SharePayload {
  v: 1
  name: string
  code: string
  params: Record<string, ParamValue>
}

export const SHARE_WARN_BYTES = 8_000
/** Longest `#s=` text we decompress; lz-string output can grow quadratically, so this also bounds memory. */
export const MAX_SHARE_CHARS = 16_000
export const MAX_CODE_CHARS = 200_000
export const MAX_NAME_CHARS = 120
export const MAX_PARAMS = 200
const MAX_TEXT_PARAM_CHARS = 1_000
const MAX_VECTOR_LENGTH = 16
const DEFAULT_NAME = 'Shared model'
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_]*$/
const RESERVED = new Set(['__proto__', 'constructor', 'prototype'])
const DAMAGED = 'The link is damaged or cut off, so the model could not be read. Ask for the link again, or for the .json file.'
const NOT_A_MODEL = 'The link does not contain a ChatSCAD model.'

export type ParseResult = { ok: true; payload: SharePayload } | { ok: false; error: string }
export type ShareLevel = 'ok' | 'long' | 'too-long'

export interface ShareLink {
  /** null when the link would be too long to open. */
  url: string | null
  bytes: number
  level: ShareLevel
  payload: SharePayload
}

const fail = (error: string): ParseResult => ({ ok: false, error })

export function encodeShare(payload: SharePayload): string {
  return compressToEncodedURIComponent(JSON.stringify(payload))
}

export function shareLevel(encoded: string, url: string): ShareLevel {
  if (encoded.length > MAX_SHARE_CHARS) return 'too-long'
  return url.length > SHARE_WARN_BYTES ? 'long' : 'ok'
}

export function createShareLink(payload: SharePayload, base: string): ShareLink {
  const encoded = encodeShare(payload)
  const url = new URL(base)
  url.hash = `s=${encoded}`
  const href = url.toString()
  const level = shareLevel(encoded, href)
  return { url: level === 'too-long' ? null : href, bytes: href.length, level, payload }
}

function paramValue(v: unknown): ParamValue | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v.length <= MAX_TEXT_PARAM_CHARS ? v : undefined
  if (Array.isArray(v) && v.length > 0 && v.length <= MAX_VECTOR_LENGTH && v.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    return v as number[]
  }
  return undefined
}

/** Validates a decoded link or a `.json` share file before anything is written. */
export function parseSharePayload(value: unknown): ParseResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail(NOT_A_MODEL)
  const o = value as Record<string, unknown>
  if (o.v !== 1) {
    return fail(
      typeof o.v === 'number' && o.v > 1
        ? `The link was made by a newer ChatSCAD (format ${o.v}). Reload the app to update it, then open the link again.`
        : NOT_A_MODEL,
    )
  }
  if (typeof o.code !== 'string' || o.code.trim() === '') return fail('The link has no OpenSCAD code.')
  if (o.code.length > MAX_CODE_CHARS) {
    return fail(`The code in the link is longer than ${MAX_CODE_CHARS.toLocaleString('en-US')} characters.`)
  }
  const cleanName = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_CHARS) : ''

  const params = o.params === undefined ? {} : o.params
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    return fail('The parameter values in the link are not a list of names and values.')
  }
  const entries = Object.entries(params as Record<string, unknown>)
  if (entries.length > MAX_PARAMS) return fail(`The link sets more than ${MAX_PARAMS} parameters.`)
  const clean: Array<[string, ParamValue]> = []
  for (const [key, raw] of entries) {
    if (!IDENTIFIER.test(key) || RESERVED.has(key)) {
      return fail(`The link sets a parameter with an invalid name: “${key.slice(0, 40)}”.`)
    }
    const checked = paramValue(raw)
    if (checked === undefined) {
      return fail(`The value of parameter ${key} in the link is not a number, true/false, text or a list of numbers.`)
    }
    clean.push([key, checked])
  }
  return { ok: true, payload: { v: 1, name: cleanName || DEFAULT_NAME, code: o.code, params: Object.fromEntries(clean) } }
}

/** null when the hash is not a share link; otherwise the validated payload or a plain-language error. */
export function decodeShareHash(hash: string): ParseResult | null {
  if (!hash.startsWith('#s=')) return null
  let encoded = hash.slice(3)
  if (encoded.includes('%')) {
    try {
      encoded = decodeURIComponent(encoded)
    } catch {
      return fail(DAMAGED)
    }
  }
  if (encoded.length === 0) return fail(DAMAGED)
  if (encoded.length > MAX_SHARE_CHARS) {
    return fail(`The link is too long to open (over ${formatSize(MAX_SHARE_CHARS)}). Ask for the .json file instead.`)
  }
  let json: string | null
  try {
    json = decompressFromEncodedURIComponent(encoded)
  } catch {
    json = null
  }
  if (!json) return fail(DAMAGED)
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return fail(DAMAGED)
  }
  return parseSharePayload(value)
}

export function fileStem(name: string): string {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return stem || 'model'
}
