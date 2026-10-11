import { Fragment, useState, type ReactNode } from 'react'
import { createProvider } from '../ai/createProvider'
import type { AdapterKind, ProviderCapabilities } from '../ai/types'
import { isLocalBaseUrl } from '../ai/url'
import type { ProviderProfile } from '../db/db'
import { IconCheck, IconWarning } from '../ui/icons'
import { PriceTable } from './PriceTable'
import { useProvidersStore, type ProfilePatch } from './providersStore'
import { TranscriptionModelField } from './TranscriptionModelField'
import { testConnection, type ConnectionResult } from './testConnection'

const CAPABILITIES: Array<[keyof ProviderCapabilities, string]> = [
  ['streaming', 'Streaming'],
  ['vision', 'Vision (images and sketches)'],
  ['audio', 'Audio transcription'],
]

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="pc-field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint && <span className="pc-hint">{hint}</span>}
    </div>
  )
}

function ResultCallout({ result }: { result: ConnectionResult }) {
  return (
    <div className={`pc-callout ${result.ok ? 'is-ok' : 'is-error'}`} role={result.ok ? 'status' : 'alert'}>
      {result.ok ? <IconCheck className="pc-i" aria-hidden="true" /> : <IconWarning className="pc-i" aria-hidden="true" />}
      <div className="pc-callout-body">
        <strong>{result.title}</strong>
        {result.body}
      </div>
    </div>
  )
}

export function ProfileForm({ profile }: { profile: ProviderProfile }) {
  const updateProfile = useProvidersStore((s) => s.updateProfile)
  const removeProfile = useProvidersStore((s) => s.removeProfile)
  const setStatus = useProvidersStore((s) => s.setStatus)
  const [result, setResult] = useState<ConnectionResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showPrices, setShowPrices] = useState(false)

  const patch = (p: ProfilePatch) => void updateProfile(profile.id, p)
  const id = (name: string) => `${profile.id}-${name}`

  async function runTest() {
    setTesting(true)
    setResult(null)
    const r = await testConnection(createProvider(profile), profile.defaultModel, profile.baseUrl)
    if (r.models) patch({ cachedModels: r.models })
    setStatus(profile.id, r.ok ? 'ok' : r.kind === 'network' ? 'blocked' : 'failed')
    setResult(r)
    setTesting(false)
  }

  const modelHint =
    profile.cachedModels.length > 0
      ? `${profile.cachedModels.length} models from the provider. Type to search, or enter any model name.`
      : result && result.models === null
        ? "Couldn't load the model list. Type a model name instead."
        : 'Test the connection to load the model list, or type a model name.'

  return (
    <section aria-label="Profile" className="flex min-h-0 min-w-0 flex-col bg-panel md:overflow-y-auto md:border-l md:border-line">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <span className="truncate font-semibold">{profile.name || 'Untitled profile'}</span>
        <span className="flex-1" />
        {confirmDelete ? (
          <>
            <button type="button" className="pc-btn is-sm is-ghost" onClick={() => setConfirmDelete(false)}>
              Keep
            </button>
            <button type="button" className="pc-btn is-sm is-danger" onClick={() => void removeProfile(profile.id)}>
              Delete for good
            </button>
          </>
        ) : (
          <button type="button" className="pc-btn is-sm is-danger" onClick={() => setConfirmDelete(true)}>
            Delete profile
          </button>
        )}
      </div>

      <div className="flex max-w-[640px] flex-col gap-5 p-6">
        {result && <ResultCallout result={result} />}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id={id('name')} label="Name">
            <div className="pc-input">
              <input id={id('name')} value={profile.name} onChange={(e) => patch({ name: e.target.value })} />
            </div>
          </Field>
          <Field id={id('adapter')} label="Adapter">
            <select
              id={id('adapter')}
              className="pc-select"
              value={profile.adapter}
              onChange={(e) => patch({ adapter: e.target.value as AdapterKind })}
            >
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </Field>
        </div>

        <Field
          id={id('url')}
          label="Base URL"
          hint={
            profile.adapter === 'anthropic'
              ? 'Usually https://api.anthropic.com.'
              : 'Any OpenAI-compatible endpoint: OpenAI, OpenRouter, Groq, Mistral, DeepSeek, Together, LM Studio, Ollama.'
          }
        >
          <div className="pc-input is-mono">
            <input id={id('url')} value={profile.baseUrl} spellCheck={false} onChange={(e) => patch({ baseUrl: e.target.value })} />
          </div>
        </Field>

        <Field
          id={id('key')}
          label="API key"
          hint="Keys stay in this browser and are never included in exports or share links. Use a key with a spending limit where your provider allows it."
        >
          <div className="pc-input is-mono">
            <input
              id={id('key')}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={isLocalBaseUrl(profile.baseUrl) ? 'Not needed for a server on this computer' : 'Paste your API key'}
              value={profile.apiKey}
              onChange={(e) => patch({ apiKey: e.target.value })}
            />
          </div>
        </Field>

        <Field id={id('model')} label="Default model" hint={modelHint}>
          <div className="pc-input is-mono">
            <input
              id={id('model')}
              list={id('models')}
              spellCheck={false}
              value={profile.defaultModel}
              onChange={(e) => patch({ defaultModel: e.target.value })}
            />
          </div>
          <datalist id={id('models')}>
            {profile.cachedModels.map((m) => (
              <option key={m.id} value={m.id} />
            ))}
          </datalist>
        </Field>

        <div className="pc-stack">
          <span className="pc-label">Capabilities</span>
          {CAPABILITIES.map(([key, label]) => (
            <Fragment key={key}>
              <label className="pc-switch">
                <input
                  type="checkbox"
                  checked={profile.capabilities[key]}
                  onChange={(e) =>
                    patch({
                      capabilities: {
                        ...profile.capabilities,
                        [key]: e.target.checked,
                      },
                    })
                  }
                />
                <span className="pc-track" />
                {label}
              </label>
              {key === 'audio' && profile.capabilities.audio && <TranscriptionModelField />}
            </Fragment>
          ))}
        </div>

        <div className="pc-row">
          <button type="button" className="pc-btn is-primary" disabled={testing} onClick={() => void runTest()}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <button type="button" className="pc-btn is-ghost" aria-expanded={showPrices} onClick={() => setShowPrices((s) => !s)}>
            Edit price table
          </button>
        </div>

        {showPrices && <PriceTable profile={profile} onChange={(priceTable) => patch({ priceTable })} />}
      </div>
    </section>
  )
}
