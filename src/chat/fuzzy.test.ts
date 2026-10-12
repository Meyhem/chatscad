import { fuzzyFilter, fuzzyScore } from './fuzzy'

it('matches an empty query against everything', () => {
  expect(fuzzyScore('', 'anything')).toBe(0)
})

it('matches characters in order with gaps, ignoring case', () => {
  expect(fuzzyScore('cs45', 'claude-sonnet-4-5')).not.toBeNull()
  expect(fuzzyScore('GPT5M', 'openai/gpt-5-mini')).not.toBeNull()
})

it('rejects characters out of order or missing', () => {
  expect(fuzzyScore('5gpt', 'openai/gpt-5-mini')).toBeNull()
  expect(fuzzyScore('qwenz', 'qwen/qwen3-coder')).toBeNull()
})

it('requires every space-separated word to match, in any order', () => {
  expect(fuzzyScore('coder qwen', 'qwen/qwen3-coder')).not.toBeNull()
  expect(fuzzyScore('coder llama', 'qwen/qwen3-coder')).toBeNull()
})

it('ranks contiguous and word-start matches above scattered ones', () => {
  const ranked = fuzzyFilter('sonnet', ['some-other-nano-net', 'claude-sonnet-4-5', 'sonnet-mini'])
  expect(ranked.slice(0, 2)).toEqual(['sonnet-mini', 'claude-sonnet-4-5'])
  expect(ranked[2]).toBe('some-other-nano-net')
})

it('keeps the original order when the query is empty', () => {
  expect(fuzzyFilter('  ', ['b', 'a'])).toEqual(['b', 'a'])
})
