import type { Project, Version } from '../db/db'

export function makeVersion(over: Partial<Version> & Pick<Version, 'id'>): Version {
  return {
    projectId: 'p1',
    parentId: null,
    code: 'cube(1);',
    params: {},
    source: 'manual',
    kind: 'main',
    variantGroupId: null,
    label: 'v1',
    message: '',
    model: null,
    compileStatus: 'ok',
    renderMs: 10,
    thumbnailBlobId: null,
    createdAt: 1,
    ...over,
  }
}

export function makeProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Holder',
    createdAt: 1,
    updatedAt: 1,
    headVersionId: null,
    providerProfileId: null,
    enabledLibraries: [],
    origin: 'blank',
    ...over,
  }
}
