import { parseStl } from '../render/stl'
import { binaryStl, BOX_TRI } from '../test/stl'
import { meshToGeometry } from './geometry'

it('builds a non-indexed geometry with positions, normals and a bounding box', () => {
  const g = meshToGeometry(parseStl(binaryStl([BOX_TRI])))
  expect(g.getAttribute('position').count).toBe(3)
  expect(g.getAttribute('normal').count).toBe(3)
  expect(g.boundingBox?.max.toArray()).toEqual([20, 20, 10])
})
