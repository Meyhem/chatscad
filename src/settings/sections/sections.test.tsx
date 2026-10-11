import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '../../db/db'
import { saveBackupFile } from '../../history/projectFile'
import { useProjectStore } from '../../history/projectStore'
import { makeProject } from '../../test/fixtures'
import { SETTINGS_SECTIONS } from '../sections'
import { DEFAULT_LAYOUT } from '../../layout/panelLayout'
import { usePrefs } from '../prefsStore'
import { useSettingsStore } from '../settingsStore'
import { AppearanceSection } from './AppearanceSection'
import { LibrariesSection } from './LibrariesSection'
import { RenderingSection } from './RenderingSection'
import { StorageSection } from './StorageSection'
import { UsageSection } from './UsageSection'

vi.mock('../../history/projectFile', () => ({ saveBackupFile: vi.fn(async () => {}) }))
vi.mock('../../db/profiles', () => ({
  listProfiles: async () => [
    { id: 'a', name: 'Anthropic' },
    { id: 'o', name: 'Ollama' },
  ],
}))
vi.mock('../../db/usageTotals', async (orig) => ({
  ...(await orig<typeof import('../../db/usageTotals')>()),
  usageTotalsSince: async (since: number) =>
    since > new Date(2000, 0, 2).getTime() && since === new Date(new Date().setHours(0, 0, 0, 0)).getTime()
      ? new Map([['a', { tokens: 41_200, cost: 0.12, unpriced: 0 }]])
      : new Map([
          ['a', { tokens: 412_000, cost: 1.84, unpriced: 0 }],
          ['o', { tokens: 58_000, cost: 0, unpriced: 3 }],
        ]),
}))

const update = vi.fn(async () => {})

beforeEach(() => {
  update.mockClear()
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS }, update })
})
afterEach(() => vi.unstubAllGlobals())

it('lists the settings sections in the order of the Providers screen', () => {
  expect(SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
    'AI providers', 'Usage and cost', 'Rendering', 'Libraries', 'Appearance', 'Storage and backup', 'Security',
  ])
  expect(SETTINGS_SECTIONS[0]!.Component).toBeNull()
  expect(SETTINGS_SECTIONS.slice(1).every((s) => s.Component !== null)).toBe(true)
})

it('saves rendering settings in their units and rejects values out of range', () => {
  render(<RenderingSection />)
  fireEvent.change(screen.getByLabelText('Debounce'), { target: { value: '900' } })
  fireEvent.blur(screen.getByLabelText('Debounce'))
  expect(update).toHaveBeenCalledWith({ debounceMs: 900 })
  fireEvent.change(screen.getByLabelText('Timeout'), { target: { value: '30' } })
  fireEvent.blur(screen.getByLabelText('Timeout'))
  expect(update).toHaveBeenCalledWith({ timeoutMs: 30_000 })
  fireEvent.change(screen.getByLabelText('Auto-fix attempts'), { target: { value: '9' } })
  fireEvent.blur(screen.getByLabelText('Auto-fix attempts'))
  expect(screen.getByText('Enter a whole number from 0 to 5')).toBeInTheDocument()
  expect(update).toHaveBeenCalledTimes(2)
})

it('switches the theme', () => {
  render(<AppearanceSection />)
  expect(screen.getByRole('radio', { name: 'System' })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: 'Light' }))
  expect(update).toHaveBeenCalledWith({ theme: 'light' })
})

it('enables libraries for the open project', () => {
  const setEnabledLibraries = vi.fn(async () => {})
  useProjectStore.setState({ project: makeProject({ enabledLibraries: ['MCAD'] }), setEnabledLibraries })
  render(<LibrariesSection />)
  expect(screen.getByRole('checkbox', { name: 'MCAD' })).toBeChecked()
  expect(screen.getByText('BOSL2 v2.0.766 · BSD-2-Clause · include <BOSL2/std.scad>')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('checkbox', { name: 'BOSL2' }))
  expect(setEnabledLibraries).toHaveBeenCalledWith(['BOSL2', 'MCAD'])
  useProjectStore.setState({ project: null })
})

it('shows usage per profile for today and this month', async () => {
  render(<UsageSection />)
  expect(await screen.findByTestId('usage-a')).toHaveTextContent('Anthropic$0.120 · 41,200 tok$1.84 · 412,000 tok')
  expect(screen.getByTestId('usage-o')).toHaveTextContent('Ollama$0.000 · 0 tok$0.000 · 58,000 tok')
  expect(screen.getByText(/3 calls this month had no price/)).toBeInTheDocument()
})

it('shows storage use and persistence, asks to keep data, and exports everything', async () => {
  const persist = vi.fn(async () => true)
  let persisted = false
  vi.stubGlobal('navigator', {
    storage: {
      estimate: async () => ({ usage: 12.4 * 1024 * 1024, quota: 2.1 * 1024 ** 3 }),
      persisted: async () => persisted,
      persist: async () => ((persisted = await persist()), persisted),
    },
  })
  render(<StorageSection />)
  expect(await screen.findByText('Using 12.4 MB of 2.1 GB')).toBeInTheDocument()
  expect(screen.getByText(/The browser may clear projects when space runs low/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Ask to keep data' }))
  await waitFor(() => expect(screen.getByText(/won't clear your projects/)).toBeInTheDocument())
  fireEvent.click(screen.getByRole('button', { name: 'Export all projects (.json)' }))
  expect(saveBackupFile).toHaveBeenCalled()
})

it('offers the visual check after the auto-fix attempts, off by default', async () => {
  render(<RenderingSection />)
  const toggle = await screen.findByRole('checkbox', { name: /Visual check after each AI change/ })
  expect(toggle).not.toBeChecked()
  const fields = screen.getAllByRole('textbox').map((el) => el.id)
  expect(fields.at(-1)).toBe('autofix')
  expect(screen.getByLabelText('Auto-fix attempts').compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('resets the desktop panel layout', async () => {
  const update = vi.spyOn(usePrefs.getState(), 'update').mockResolvedValue()
  usePrefs.setState({ update })
  render(<AppearanceSection />)
  expect(screen.getByText('Panel sizes are saved on this device. Double-click a divider to reset just that one.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }))
  expect(update).toHaveBeenCalledWith({ panelLayout: DEFAULT_LAYOUT })
  usePrefs.setState(usePrefs.getInitialState(), true)
})
