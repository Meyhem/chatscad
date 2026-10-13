import { editDistance, fuzzyFilter, fuzzyScore, isStrongMatch, normalise } from './fuzzy'

it('matches an empty query against everything', () => {
  expect(fuzzyScore('', 'anything')).toBe(0)
})

it('matches characters in order with gaps, ignoring case', () => {
  expect(fuzzyScore('cs45', 'claude-sonnet-4-5')).not.toBeNull()
  expect(fuzzyScore('GPT5M', 'openai/gpt-5-mini')).not.toBeNull()
})

it('rejects characters out of order or missing', () => {
  expect(fuzzyScore('5gpt', 'openai/gpt-5-mini')).toBeNull()
  expect(fuzzyScore('qwexyz', 'qwen/qwen3-coder')).toBeNull()
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

const DEEPSEEK = ['deepseek/deepseek-v4-flash', 'DeepSeek: DeepSeek V4 Flash']

it('normalises case, punctuation and accents to plain words', () => {
  expect(normalise('DeepSeek/V4-flash_2.5')).toBe('deepseek v4 flash 2 5')
  expect(normalise('  Café / Crème  ')).toBe('cafe creme')
  expect(normalise('通义千问-Max')).toBe('通义千问 max')
  expect(normalise(' - / ')).toBe('')
})

it('finds a model from loose words in any order', () => {
  for (const q of ['dee fla 4', 'flash dee v4', '4 flash deep']) expect(fuzzyScore(q, DEEPSEEK)).not.toBeNull()
})

it('ignores punctuation and case in the query and the model', () => {
  for (const q of ['deep-seek v4', 'DeepSeek/V4', 'deepseek_v4']) expect(fuzzyScore(q, 'deepseek/deepseek-v4-flash')).not.toBeNull()
})

it('lets each word match either the id or the name', () => {
  expect(fuzzyScore('falcon m1', ['acme/m1', 'Acme Falcon'])).not.toBeNull()
  expect(fuzzyScore('falcon', ['acme/m1'])).toBeNull()
})

it('tolerates small typos in long words, ranked below exact and prefix matches', () => {
  expect(fuzzyScore('flsh', DEEPSEEK)).not.toBeNull()
  expect(fuzzyScore('deepsek', DEEPSEEK)).not.toBeNull()
  expect(fuzzyScore('flahs', DEEPSEEK)).not.toBeNull()
  expect(fuzzyScore('deepseck', DEEPSEEK)).not.toBeNull()
  const typo = fuzzyScore('flahs', DEEPSEEK)!
  expect(fuzzyScore('flash', DEEPSEEK)!).toBeGreaterThan(typo)
  expect(fuzzyScore('fla', DEEPSEEK)!).toBeGreaterThan(typo)
})

it('allows no typos in short words', () => {
  expect(fuzzyScore('gtp', 'openai/gpt-5-mini')).toBeNull()
  expect(fuzzyScore('mimi', 'openai/gpt-5-mini')).toBeNull()
})

it('ranks whole words above word starts above scattered letters', () => {
  const ranked = fuzzyFilter('flash', ['x/f-l-a-s-h', 'x/flashy', 'x/flash'])
  expect(ranked).toEqual(['x/flash', 'x/flashy', 'x/f-l-a-s-h'])
})

it('matches everything in the original order for a query of only punctuation', () => {
  expect(fuzzyFilter(' - / ', ['b', 'a'])).toEqual(['b', 'a'])
})

it('filters any item type through its keys, and survives missing or non-Latin names', () => {
  const models = [{ id: 'qwen/qwen3-max', name: '通义千问 Max' }, { id: 'deepseek/deepseek-v4-flash' }]
  const keys = (m: { id: string; name?: string }) => [m.id, m.name ?? '']
  expect(fuzzyFilter('通义', models, keys)).toEqual([models[0]])
  expect(fuzzyFilter('dee fla', models, keys)).toEqual([models[1]])
})

it('counts edit distance with neighbour swaps as one edit', () => {
  expect(editDistance('flahs', 'flash')).toBe(1)
  expect(editDistance('deepseck', 'deepseek')).toBe(1)
  expect(editDistance('qwexyz', 'qwen3')).toBe(3)
  expect(editDistance('', 'abc')).toBe(3)
})

it('calls a match strong only when every word appears as written', () => {
  expect(isStrongMatch('dee fla 4', DEEPSEEK)).toBe(true)
  expect(isStrongMatch('flahs', DEEPSEEK)).toBe(false) // typo
  expect(isStrongMatch('dpsk', DEEPSEEK)).toBe(false) // scattered letters
  expect(isStrongMatch(' - ', DEEPSEEK)).toBe(false) // no words
})
