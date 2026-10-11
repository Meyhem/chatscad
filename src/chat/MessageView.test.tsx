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
