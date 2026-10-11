import type { Version } from '../db/db'

let n = 0

/** A complete Version with sensible defaults; override what the test is about. */
export function version(over: Partial<Version> = {}): Version {
  n++
  return {
    id: `version-${n}`,
    projectId: 'project-1',
    parentId: null,
    code: `cube(${n});`,
    params: {},
    source: 'ai',
    kind: 'main',
    variantGroupId: null,
    label: `v${n}`,
    message: '',
    model: null,
    compileStatus: 'ok',
    renderMs: 10,
    thumbnailBlobId: null,
    createdAt: n,
    ...over,
  }
}
