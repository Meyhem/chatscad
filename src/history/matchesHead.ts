import type { Version } from '../db/db'
import { paramsEqual, type Params } from '../render/params'
import { paramOverrides } from '../scad/customizer'

/** True when the editor shows exactly the head version: same code, same effective overrides. */
export function matchesHead(code: string, params: Params, head: Version | null): boolean {
  return head !== null && code === head.code && paramsEqual(paramOverrides(code, params), head.params)
}
