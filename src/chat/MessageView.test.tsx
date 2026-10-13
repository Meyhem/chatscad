import { render, screen } from '@testing-library/react'
import type { ChatMessage } from './chatStore'
import { MessageView } from './MessageView'

const reply = (over: Partial<ChatMessage>): ChatMessage => ({
  id: 'r',
  role: 'assistant',
  text: 'Made a 4-slot holder.',
  turnLabel: 'v1',
  model: 'claude-sonnet-5-5',
  usage: { inputTokens: 1000, outputTokens: 1310, cost: 0.011 },
  status: 'done',
  compileStatus: 'ok',
  ...over,
})

it('shows a user prompt in an accent bubble', () => {
  const { container } = render(
    <MessageView message={{ id: 'u', role: 'user', text: 'A holder', turnLabel: null, model: null, usage: null, status: 'done' }} />,
  )
  expect(container.querySelector('.pc-msg.is-user .pc-msg-body')).toHaveTextContent('A holder')
})

it('shows the reply with its turn chip, model, tokens and cost in mono', () => {
  render(<MessageView message={reply({})} />)
  const meta = screen.getByTestId('chat-reply').querySelector('.pc-msg-meta')!
  expect(meta.querySelector('.pc-chip.is-accent')).toHaveTextContent('v1')
  expect(meta).toHaveTextContent('claude-sonnet-5-5')
  expect(screen.getByTestId('msg-cost')).toHaveTextContent('2,310 tok · $0.011')
  expect(screen.getByTestId('msg-cost')).toHaveClass('pc-mono')
})

it('says "price unknown" when the reply has no price', () => {
  render(<MessageView message={reply({ usage: { inputTokens: 5, outputTokens: 5, cost: null } })} />)
  expect(screen.getByTestId('msg-cost')).toHaveTextContent('10 tok · price unknown')
})

it('marks a reply that failed to compile and shows the error as a callout, not a dialog', () => {
  render(
    <MessageView
      message={reply({ compileStatus: 'error', error: { title: 'Line 16: Parser error: syntax error', body: 'OpenSCAD exited with code 1' } })}
    />,
  )
  expect(screen.getByTestId('chat-reply').querySelector('.pc-chip')).toHaveTextContent('Failed')
  const alert = screen.getByRole('alert')
  expect(alert).toHaveClass('pc-callout', 'is-error')
  expect(alert).toHaveTextContent('Line 16: Parser error: syntax error')
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('renders model text as text: backticks become code, HTML stays literal', () => {
  const { container } = render(
    <MessageView message={reply({ text: 'Set `wall = 2.4` <img src=x onerror="alert(1)"> and **bold**' })} />,
  )
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('code')).toHaveTextContent('wall = 2.4')
  expect(screen.getByTestId('chat-reply')).toHaveTextContent('<img src=x onerror="alert(1)"> and **bold**')
})

it('while streaming, shows only the prose and says the code is being written', () => {
  render(<MessageView message={reply({ status: 'streaming', usage: null, turnLabel: null, text: 'Made a hook.\n\n```openscad\nmodule h' })} />)
  expect(screen.getByTestId('chat-reply')).toHaveTextContent('Made a hook.')
  expect(screen.getByTestId('chat-reply')).not.toHaveTextContent('module h')
  expect(screen.getByText('Writing code…')).toBeInTheDocument()
  expect(screen.queryByTestId('msg-cost')).toBeNull()
})

it('shows a note as a centred caption', () => {
  render(<MessageView message={{ id: 'n', role: 'note', text: 'Stopped.', turnLabel: null, model: null, usage: null, status: 'done' }} />)
  expect(screen.getByTestId('chat-note')).toHaveTextContent('Stopped.')
})

vi.mock('../images/MessageImages', () => ({
  MessageImages: ({ ids }: { ids: string[] }) => <div data-testid="message-images">{ids.join(',')}</div>,
}))

it('shows the images sent with a prompt above its bubble', () => {
  const { container } = render(
    <MessageView
      message={{ id: 'u', role: 'user', text: 'Like this', turnLabel: null, model: null, usage: null, status: 'done', imageBlobIds: ['i1', 'i2'] }}
    />,
  )
  const images = screen.getByTestId('message-images')
  expect(images).toHaveTextContent('i1,i2')
  expect(images.nextElementSibling).toBe(container.querySelector('.pc-msg-body'))
})

it('shows the reasoning box above the reply text', () => {
  render(<MessageView message={reply({ reasoning: 'Wall is 1.6 mm.', reasoningMs: 7_000 })} />)
  const box = screen.getByText('Thought for 7 s').closest('.pc-reasoning')!
  const body = screen.getByText('Made a 4-slot holder.')
  expect(box.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('drops the "Thinking…" status row once reasoning streams, and keeps "Writing code…"', () => {
  const streaming = { status: 'streaming' as const, usage: null, turnLabel: null, reasoning: 'Hmm', reasoningStartedAt: Date.now() }
  const { rerender } = render(<MessageView message={reply({ ...streaming, text: '' })} />)
  expect(screen.queryByText('Thinking…')).toBeNull()
  rerender(<MessageView message={reply({ ...streaming, text: 'Made a hook.\n\n```openscad\nmodule h' })} />)
  expect(screen.getByText('Writing code…')).toBeInTheDocument()
})

it('shows the cut-off callout', () => {
  render(
    <MessageView
      message={reply({
        text: '',
        turnLabel: null,
        compileStatus: undefined,
        error: { title: 'The reply was cut off before it wrote any code', body: 'The model reached its output limit (4,096 tokens).' },
      })}
    />,
  )
  expect(screen.getByRole('alert')).toHaveTextContent('The reply was cut off before it wrote any code')
})

describe('agent cards', () => {
  const noteFor = (cardId: string): ChatMessage => ({ id: 'n', role: 'note', text: 'Plan · 2 checks', turnLabel: null, model: null, usage: null, status: 'done', cardId })

  it('shows the live card behind a note', async () => {
    const { useAgentStore } = await import('../agent/agentStore')
    useAgentStore.setState({
      cards: {
        p: { kind: 'plan', id: 'p', noteId: 'n', request: 'A box', then: 'build', status: 'ready', checks: [{ id: 'c', kind: 'part', text: 'A box' }], parts: [], model: 'm', usage: null, error: null },
      },
    })
    render(<MessageView message={noteFor('p')} />)
    expect(screen.getByTestId('plan-card')).toBeInTheDocument()
  })

  it('falls back to the note text when the card is gone, as after a reload', () => {
    render(<MessageView message={noteFor('gone')} />)
    expect(screen.getByTestId('chat-note')).toHaveTextContent('Plan · 2 checks')
  })
})
