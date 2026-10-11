import { useMemo } from 'react'
import type { Version } from '../db/db'
import { paramsEqual, type Params } from '../render/params'
import { paramOverrides } from '../scad/customizer'
import { useAppStore } from '../state/store'
import { useProjectStore } from './projectStore'

export function renderedVersionLabel(
  versions: Version[],
  head: Version | null,
  renderedCode: string | null,
  renderedParams: Params | null,
): string | null {
  if (!head || renderedCode === null) return null
  const overrides = paramOverrides(renderedCode, renderedParams ?? {})
  const matches = (v: Version) => v.code === renderedCode && paramsEqual(v.params, overrides) && v.compileStatus !== 'error'
  const byId = new Map(versions.map((v) => [v.id, v]))
  const seen = new Set<string>()
  for (let v: Version | undefined = head; v && !seen.has(v.id); v = v.parentId ? byId.get(v.parentId) : undefined) {
    seen.add(v.id)
    if (matches(v)) return v.label
  }
  return [...versions].reverse().find(matches)?.label ?? null
}

export function useRenderedVersionLabel(): string | null {
  const versions = useProjectStore((s) => s.versions)
  const head = useProjectStore((s) => s.head)
  const renderedCode = useAppStore((s) => s.renderedCode)
  const renderedParams = useAppStore((s) => s.renderedParams)
  return useMemo(() => renderedVersionLabel(versions, head, renderedCode, renderedParams), [versions, head, renderedCode, renderedParams])
}
