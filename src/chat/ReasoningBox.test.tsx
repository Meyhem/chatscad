import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ChatMessage } from './chatStore'
import { formatDuration, lastLine, ReasoningBox } from './ReasoningBox'

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'r',
  role: 'assistant',
  text: '',
  turnLabel: null,
  model: 'm',
  usage: null,
  status: 'done',
  ...over,
})

afterEach(() => vi.useRealTimers())

it('formats durations with units', () => {
  expect(formatDuration(400)).toBe('0 s')
  expect(formatDuration(38_200)).toBe('38 s')
  expect(formatDuration(112_000)).toBe('1 min 52 s')
})

it('takes the last non-empty line', () => {
  expect(lastLine('one\ntwo  \n\n')).toBe('two')
  expect(lastLine('')).toBe('')
})

it('renders nothing without reasoning', () => {
  const { container } = render(<ReasoningBox message={msg({})} />)
  expect(container).toBeEmptyDOMElement()
})

it('while streaming: a ticking "Thinking" header and the newest line, shimmering, outside the closed box', () => {
  vi.useFakeTimers({ now: 10_000 })
  render(<ReasoningBox message={msg({ status: 'streaming', reasoning: 'Wall is 1.6 mm.\nSo the lid', reasoningStartedAt: 10_000 })} />)
  expect(screen.getByText('Thinking · 0 s')).toBeInTheDocument()
  const live = screen.getByText('So the lid')
  expect(live).toHaveClass('pc-reasoning-live', 'pc-shimmer')
  expect(live).toHaveAttribute('aria-hidden', 'true')
  act(() => vi.advanceTimersByTime(38_000))
  expect(screen.getByText('Thinking · 38 s')).toBeInTheDocument()
})

it('hides the live line once opened', () => {
  render(<ReasoningBox message={msg({ status: 'streaming', reasoning: 'a\nb', reasoningStartedAt: Date.now() })} />)
  const details = document.querySelector('details')!
  details.open = true
  fireEvent(details, new Event('toggle'))
  expect(document.querySelector('.pc-reasoning-live')).toBeNull()
})

it('when done: "Thought for" with tokens, collapsed, full text inside', () => {
  render(<ReasoningBox message={msg({ reasoning: 'Wall is 1.6 mm.\nDone.', reasoningMs: 112_000, reasoningTokens: 14_210 })} />)
  expect(screen.getByText('Thought for 1 min 52 s · 14,210 tokens')).toBeInTheDocument()
  expect(document.querySelector('details')).not.toHaveAttribute('open')
  expect(document.querySelector('.pc-reasoning-body')).toHaveTextContent('Wall is 1.6 mm. Done.')
  expect(document.querySelector('.pc-reasoning-live')).toBeNull()
})

it('says "Reasoning" when the duration is unknown', () => {
  render(<ReasoningBox message={msg({ reasoning: 'x' })} />)
  expect(screen.getByText('Reasoning')).toBeInTheDocument()
})

it('renders HTML in the reasoning as text', () => {
  render(<ReasoningBox message={msg({ reasoning: '<img src=x onerror=alert(1)>', reasoningMs: 1000 })} />)
  expect(document.querySelector('.pc-reasoning img')).toBeNull()
  expect(document.querySelector('.pc-reasoning-body')).toHaveTextContent('<img src=x onerror=alert(1)>')
})
