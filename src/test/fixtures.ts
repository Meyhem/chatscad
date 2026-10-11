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

/** The cube-with-a-hole model new projects used to start with; tests that need something to render load it explicitly. */
export const STARTER_CODE = `// ChatSCAD: edit me
/* [Dimensions] */
width = 20;  // [5:1:100]
depth = 20;  // [5:1:100]
height = 10; // [2:1:50]

difference() {
  cube([width, depth, height]);
  translate([width / 2, depth / 2, 2])
    cylinder(h = height, r = min(width, depth) / 4, $fn = 48);
}
`
