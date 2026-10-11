import { failedResult } from '../render/result'
import { parseStl } from '../render/stl'
import type { RenderResult } from '../render/types'
import { binaryStl, BOX_TRI } from './stl'

export function okResult(): RenderResult {
  const stl = binaryStl([BOX_TRI])
  return { ok: true, mesh: parseStl(stl), stl, logs: [], diagnostics: [], renderMs: 12 }
}

export function errorResult(message = 'OpenSCAD exited with code 1'): RenderResult {
  return failedResult(message, {
    logs: [{ stream: 'stderr', text: 'ERROR: Parser error in file "/main.scad", line 1: syntax error' }],
    renderMs: 5,
  })
}
