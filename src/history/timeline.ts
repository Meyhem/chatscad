import type { Version } from '../db/db'

export interface TimelineRow {
  version: Version
  branch: boolean
  isHead: boolean
  variantsNotPicked: number
}

export interface Timeline {
  rows: TimelineRow[]
  count: number
  branches: number
}

const byTime = (a: Version, b: Version) => a.createdAt - b.createdAt

export function buildTimeline(versions: Version[], headId: string | null): Timeline {
  const main = versions.filter((v) => v.kind === 'main')
  const byId = new Map(main.map((v) => [v.id, v]))
  const children = new Map<string | null, Version[]>()
  for (const v of main) children.set(v.parentId, [...(children.get(v.parentId) ?? []), v])
  for (const list of children.values()) list.sort(byTime)

  const variants = new Map<string, number>()
  for (const v of versions) if (v.kind === 'variant' && v.variantGroupId) variants.set(v.variantGroupId, (variants.get(v.variantGroupId) ?? 0) + 1)

  const headPath = new Set<string>()
  for (let id = headId; id !== null && !headPath.has(id); id = byId.get(id)?.parentId ?? null) headPath.add(id)

  const roots = children.get(null) ?? []
  const trunk: Version[] = []
  const seen = new Set<string>()
  let cur: Version | undefined = roots.find((r) => headPath.has(r.id)) ?? roots[0]
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    trunk.push(cur)
    const kids: Version[] = children.get(cur.id) ?? []
    cur = kids.find((k) => headPath.has(k.id)) ?? kids[0]
  }

  const subtree = (root: Version): Version[] => [root, ...(children.get(root.id) ?? []).flatMap(subtree)]
  const row = (version: Version, branch: boolean): TimelineRow => ({
    version,
    branch,
    isHead: version.id === headId,
    variantsNotPicked: version.variantGroupId ? (variants.get(version.variantGroupId) ?? 0) : 0,
  })
  const branchRows = (root: Version) => subtree(root).sort((a, b) => b.createdAt - a.createdAt).map((v) => row(v, true))

  const rows: TimelineRow[] = []
  let branches = 0
  for (const t of [...trunk].reverse()) {
    rows.push(row(t, false))
    const off = (children.get(t.id) ?? []).filter((c) => !seen.has(c.id))
    branches += off.length
    for (const b of [...off].reverse()) rows.push(...branchRows(b))
  }
  for (const r of roots) {
    if (seen.has(r.id)) continue
    branches++
    rows.push(...branchRows(r))
  }
  return { rows, count: main.length, branches }
}

export function formatAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.floor(hours / 24)} d`
}

export function timelineCaption(t: Timeline): string {
  const versions = `${t.count} version${t.count === 1 ? '' : 's'}`
  return t.branches > 0 ? `${versions} · ${t.branches} branch${t.branches === 1 ? '' : 'es'}` : versions
}
