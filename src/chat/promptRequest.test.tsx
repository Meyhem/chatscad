import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { librarySection } from '../ai/libraryPrompt'
import { useChatStore, type ChatMessage } from './chatStore'
import { ProjectCostCaption } from './ProjectCostCaption'
import { ComposerBridge, fillComposer, usePromptRequest } from './promptRequest'

function Composer() {
  const [text, setText] = useState('')
  return (
    <>
      <textarea aria-label="Prompt" value={text} onChange={(e) => setText(e.target.value)} />
      <output data-testid="state">{text}</output>
    </>
  )
}

beforeEach(() => usePromptRequest.setState({ request: null }))

it('fills a controlled composer so React state follows, and focuses it', () => {
  render(<Composer />)
  expect(fillComposer('Add annotations')).toBe(true)
  expect(screen.getByTestId('state')).toHaveTextContent('Add annotations')
  expect(screen.getByLabelText('Prompt')).toHaveFocus()
})

it('reports when there is no composer to fill', () => {
  expect(fillComposer('x', document.createElement('div'))).toBe(false)
})

it('applies a requested prompt once the composer is on screen, then clears the request', () => {
  const { rerender } = render(<ComposerBridge />)
  act(() => usePromptRequest.getState().ask('Add annotations'))
  expect(usePromptRequest.getState().request?.text).toBe('Add annotations')
  rerender(
    <>
      <ComposerBridge />
      <Composer />
    </>,
  )
  act(() => usePromptRequest.getState().ask('Add annotations, please'))
  expect(screen.getByTestId('state')).toHaveTextContent('Add annotations, please')
  expect(usePromptRequest.getState().request).toBeNull()
})

it('shows the project cost from the loaded chat', () => {
  const m = (cost: number | null): ChatMessage => ({
    id: crypto.randomUUID(), role: 'assistant', text: '', turnLabel: null, model: null, status: 'done',
    usage: { inputTokens: 1, outputTokens: 1, cost },
  })
  useChatStore.setState({ messages: [m(0.011), m(0.006), m(null)] })
  render(<ProjectCostCaption />)
  expect(screen.getByTestId('project-cost')).toHaveTextContent('$0.017 this project')
})

it('tells the model which libraries it may use, and nothing when none are enabled', () => {
  expect(librarySection([])).toBe('')
  const text = librarySection(['BOSL2', 'MCAD', 'bogus'])
  expect(text).toContain('include <BOSL2/std.scad>')
  expect(text).toContain('use <MCAD/boxes.scad>')
  expect(text).not.toContain('bogus')
})
