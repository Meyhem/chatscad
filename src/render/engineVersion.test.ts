import { engineLabel, loadEngineVersion, parseEngineVersion } from './engineVersion'

const VERSION = 'https://files.openscad.org/snapshots/OpenSCAD-2026.10.08-WebAssembly-web.zip\nsha256 274c\n'

it('reads the snapshot date from the installed VERSION file', () => {
  expect(parseEngineVersion(VERSION)).toBe('2026.10.08')
  expect(parseEngineVersion('https://example.test/custom.zip')).toBeNull()
})

it('labels the console head with the engine and backend', () => {
  expect(engineLabel('2026.10.08')).toBe('OpenSCAD 2026.10.08 · manifold')
  expect(engineLabel(null)).toBe('OpenSCAD · manifold')
})

it('loads the version from the base path and survives failures', async () => {
  const ok = vi.fn(async () => new Response(VERSION))
  expect(await loadEngineVersion(ok as unknown as typeof fetch)).toBe('2026.10.08')
  expect(ok).toHaveBeenCalledWith('/openscad/VERSION')
  expect(await loadEngineVersion((async () => new Response('', { status: 404 })) as unknown as typeof fetch)).toBeNull()
  expect(await loadEngineVersion((async () => Promise.reject(new Error('offline'))) as unknown as typeof fetch)).toBeNull()
})
