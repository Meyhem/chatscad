import { computeCameraFit } from './cameraFit'

const box = { min: [0, 0, 0] as [number, number, number], max: [20, 20, 10] as [number, number, number] }

it('targets the bounding box centre', () => {
  expect(computeCameraFit(box, 45, 1).target).toEqual([10, 10, 5])
})

it('places the camera far enough to contain the bounding sphere', () => {
  const fit = computeCameraFit(box, 45, 1, 1)
  const radius = Math.hypot(20, 20, 10) / 2
  expect(fit.distance).toBeGreaterThanOrEqual(radius / Math.sin((45 * Math.PI) / 360) - 1e-9)
  const [px, py, pz] = fit.position
  expect(Math.hypot(px - 10, py - 10, pz - 5)).toBeCloseTo(fit.distance)
})

it('backs off further on a narrow (portrait) viewport', () => {
  expect(computeCameraFit(box, 45, 0.5).distance).toBeGreaterThan(computeCameraFit(box, 45, 1).distance)
})

it('views from the front-right and above in Z-up space', () => {
  const [px, py, pz] = computeCameraFit(box, 45, 1).position
  expect(px).toBeGreaterThan(10)
  expect(py).toBeLessThan(10)
  expect(pz).toBeGreaterThan(5)
})

it('uses a minimum radius for degenerate bounds', () => {
  expect(computeCameraFit({ min: [0, 0, 0], max: [0, 0, 0] }, 45, 1).distance).toBeGreaterThan(0)
})
