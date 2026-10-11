import { useState } from 'react'
import { disableLock, enableLock, forgetLockedKeys, isUnlocked, lock, unlock } from '../../security/lock'
import { IconLock, IconUnlock } from '../../ui/icons'
import { useSettingsStore } from '../settingsStore'

export function SecuritySection() {
  const lockMode = useSettingsStore((s) => s.settings.lockMode)
  const [unlocked, setUnlocked] = useState(isUnlocked())
  const [pass, setPass] = useState('')
  const [repeat, setRepeat] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmForget, setConfirmForget] = useState(false)

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const turnOn = () =>
    run(async () => {
      if (pass.length < 8) throw new Error('Use a passphrase of at least 8 characters')
      if (pass !== repeat) throw new Error("The passphrases don't match")
      await enableLock(pass)
      setPass('')
      setRepeat('')
      setUnlocked(true)
    })

  const tryUnlock = () =>
    run(async () => {
      if (!(await unlock(pass))) throw new Error("That passphrase didn't unlock the keys. Check it and try again.")
      setPass('')
      setUnlocked(true)
    })

  const passField = (id: string, label: string, value: string, set: (v: string) => void, autoComplete: string) => (
    <div className="pc-field">
      <label htmlFor={id}>{label}</label>
      <div className="pc-input">
        <input id={id} type="password" autoComplete={autoComplete} value={value} onChange={(e) => set(e.target.value)} />
      </div>
    </div>
  )

  return (
    <section aria-labelledby="security-title" className="flex max-w-[640px] flex-col gap-5 p-6">
      <h2 id="security-title" className="text-[20px] leading-[26px] font-semibold">
        Security
      </h2>
      <p className="pc-muted">
        API keys stay in this browser and are never included in exports or share links. With the lock on, they are encrypted with your
        passphrase (PBKDF2 with 310,000 rounds, then AES-GCM) and decrypted only in memory until you close the tab.
      </p>

      {!lockMode && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void turnOn()
          }}
        >
          {passField('lock-pass', 'Passphrase', pass, setPass, 'new-password')}
          {passField('lock-repeat', 'Repeat passphrase', repeat, setRepeat, 'new-password')}
          <span className="pc-hint">At least 8 characters. If you forget it, the keys can't be recovered; you would enter them again.</span>
          <div className="pc-row">
            <button type="submit" className="pc-btn is-primary" disabled={busy}>
              Turn on lock
            </button>
          </div>
        </form>
      )}

      {lockMode && !unlocked && (
        <>
          <div className="pc-callout is-warn">
            <IconLock className="pc-i" aria-hidden="true" />
            <div className="pc-callout-body">
              <strong>Your API keys are locked</strong>
              Unlock them to use AI or to change a key.
            </div>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void tryUnlock()
            }}
          >
            {passField('unlock-pass', 'Passphrase', pass, setPass, 'current-password')}
            <div className="pc-row">
              <button type="submit" className="pc-btn is-primary" disabled={busy}>
                Unlock
              </button>
              {confirmForget ? (
                <>
                  <span className="pc-caption">This deletes the encrypted keys; you will enter them again.</span>
                  <button type="button" className="pc-btn is-danger" onClick={() => void run(forgetLockedKeys)}>
                    Delete the locked keys
                  </button>
                </>
              ) : (
                <button type="button" className="pc-btn is-ghost" onClick={() => setConfirmForget(true)}>
                  Forget locked keys
                </button>
              )}
            </div>
          </form>
        </>
      )}

      {lockMode && unlocked && (
        <>
          <div className="pc-callout is-ok">
            <IconUnlock className="pc-i" aria-hidden="true" />
            <div className="pc-callout-body">
              <strong>Keys are unlocked until you close this tab</strong>
              They are stored encrypted.
            </div>
          </div>
          <div className="pc-row">
            <button
              type="button"
              className="pc-btn"
              onClick={() => {
                lock()
                setUnlocked(false)
              }}
            >
              Lock now
            </button>
            <button type="button" className="pc-btn is-ghost" disabled={busy} onClick={() => void run(async () => (await disableLock(), setUnlocked(false)))}>
              Turn off lock
            </button>
          </div>
        </>
      )}

      {error && (
        <p className="pc-hint is-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
