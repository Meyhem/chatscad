// @vitest-environment node
import { pickLatestWasmZip } from './fetch-openscad'

const listing = `
<a href="OpenSCAD-2025.01.19.ai22731-WebAssembly-web.zip">x</a>
<a href="OpenSCAD-2025.03.02.ai23104-WebAssembly-web.zip">x</a>
<a href="OpenSCAD-2025.03.02.ai23104-WebAssembly-node.zip">x</a>
<a href="OpenSCAD-2024.12.30.ai22600-x86_64.AppImage">x</a>
<a href="OpenSCAD-2025.03.02.ai23099-WebAssembly-web.zip">x</a>`

it('picks the newest web WebAssembly zip', () => {
  expect(pickLatestWasmZip(listing)).toBe('OpenSCAD-2025.03.02.ai23104-WebAssembly-web.zip')
})

it('returns null when no web zip is listed', () => {
  expect(pickLatestWasmZip('<a href="OpenSCAD-2025.01.01-x86_64.AppImage">')).toBeNull()
})
