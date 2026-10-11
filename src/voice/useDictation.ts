import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProviderProfile } from '../db/db'
import { errorMessage } from '../render/result'
import { unlockedKeyFor } from '../security/lock'
import { usePrefs } from '../settings/prefsStore'
import { getSpeechRecognition, joinDraft, micMode, speechErrorMessage, type MicMode, type SpeechRecognitionLike } from './support'
import { transcribe, type TranscribeConfig } from './transcribe'
import { useVoiceStore } from './voiceStore'

export type DictationPhase = 'idle' | 'listening' | 'transcribing' | 'error'
export interface DictationState {
  phase: DictationPhase
  message: string | null
}

const IDLE: DictationState = { phase: 'idle', message: null }

export interface DictationOptions {
  mode: MicMode
  onText(text: string, final: boolean): void
  transcribeWith(): TranscribeConfig | null
  lang?: string
}

export function useDictation({ mode, onText, transcribeWith, lang }: DictationOptions): { state: DictationState; toggle(): void } {
  const [state, setState] = useState<DictationState>(IDLE)
  const recognition = useRef<SpeechRecognitionLike | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const latest = useRef({ onText, transcribeWith })
  latest.current = { onText, transcribeWith }

  useEffect(
    () => () => {
      recognition.current?.abort()
      if (recorder.current?.state === 'recording') recorder.current.stop()
    },
    [],
  )

  const startSpeech = () => {
    const Recognition = getSpeechRecognition()
    if (!Recognition) return
    const rec = new Recognition()
    rec.lang = lang ?? navigator.language
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let text = ''
      let final = true
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript
        if (!e.results[i].isFinal) final = false
      }
      latest.current.onText(text.trim(), final)
    }
    rec.onerror = (e) => {
      if (e.error !== 'aborted') setState({ phase: 'error', message: speechErrorMessage(e.error) })
    }
    rec.onend = () => {
      recognition.current = null
      setState((s) => (s.phase === 'listening' ? IDLE : s))
    }
    recognition.current = rec
    rec.start()
    setState({ phase: 'listening', message: null })
  }

  const startRecording = async () => {
    const config = latest.current.transcribeWith()
    if (!config) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setState({ phase: 'error', message: speechErrorMessage('not-allowed') })
      return
    }
    const rec = new MediaRecorder(stream)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      recorder.current = null
      setState({ phase: 'transcribing', message: null })
      transcribe(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), config).then(
        (text) => {
          latest.current.onText(text, true)
          setState(IDLE)
        },
        (e: unknown) => setState({ phase: 'error', message: errorMessage(e) }),
      )
    }
    recorder.current = rec
    rec.start()
    setState({ phase: 'listening', message: null })
  }

  const toggle = () => {
    if (state.phase === 'transcribing') return
    if (recognition.current) {
      recognition.current.stop()
      return
    }
    if (recorder.current) {
      recorder.current.stop()
      return
    }
    if (mode === 'speech') startSpeech()
    else if (mode === 'record') void startRecording()
  }

  return { state, toggle }
}

/** The composer's mic: dictation lands after the draft as it was when the mic was tapped. */
export function useComposerDictation({
  value,
  onChange,
  profile,
}: {
  value: string
  onChange(v: string): void
  profile: ProviderProfile | null
}): { mode: MicMode; state: DictationState; toggle(): void } {
  // An encrypted key counts once it is unlocked; micMode only sees whether a usable key exists.
  const unlockedKey = profile?.keyEncrypted ? unlockedKeyFor(profile.id) : null
  const apiKey = profile ? (profile.keyEncrypted ? unlockedKey : profile.apiKey) : null
  const mode = useMemo(
    () =>
      micMode({
        speech: getSpeechRecognition() !== null,
        recorder: typeof MediaRecorder !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function',
        profile: profile && apiKey !== null ? { ...profile, keyEncrypted: false } : profile,
      }),
    [profile, apiKey],
  )
  const transcriptionModel = usePrefs((s) => s.transcriptionModel)
  const base = useRef('')
  const valueRef = useRef(value)
  valueRef.current = value

  const dictation = useDictation({
    mode,
    onText: (text, final) => {
      onChange(joinDraft(base.current, text))
      if (final) useVoiceStore.getState().setTranscript(text)
    },
    transcribeWith: () => (profile && apiKey !== null ? { baseUrl: profile.baseUrl, apiKey, model: transcriptionModel } : null),
  })

  const toggle = () => {
    if (dictation.state.phase === 'idle' || dictation.state.phase === 'error') base.current = valueRef.current
    dictation.toggle()
  }

  return { mode, state: dictation.state, toggle }
}
