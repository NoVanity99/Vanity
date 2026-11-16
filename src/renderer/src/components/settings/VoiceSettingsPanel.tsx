import { useEffect, useRef, useState } from 'react'
import { Headphones, Keyboard, Mic, Play, RotateCcw, Square } from 'lucide-react'
import { keyLabel, mouseBinding, type VoiceSettings } from '@shared/voiceSettings'
import { Button } from '@/components/Dialog'
import { cn } from '@/lib/cn'
import { isAndroid } from '@/lib/platform'
import { useSettings } from '@/state/settings'
import { previewVoiceSettings, saveVoiceSettings, useMicLevel, useVoice, voice } from '@/state/voice'
import { dbToUnit } from '@/voice/detect'
import type { AudioDevices } from '@/voice/audio'
import { Section, Toggle } from './controls'

const select =
  'h-11 w-full rounded-xl border border-border bg-surface-2 px-3 text-sm outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/15'

function Slider({ label, value, min, max, step, format, onChange, onCommit, hint }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void; onCommit?: () => void; hint?: string }): React.JSX.Element {
  return (
    <label className="block px-3 py-2.5">
      <span className="flex items-baseline justify-between text-sm">
        {label}
        <span className="font-semibold tabular-nums">{format(value)}</span>
      </span>
      {hint && <span className="block text-xs text-muted">{hint}</span>}
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onCommit} onKeyUp={onCommit} className="mt-2 w-full accent-[var(--color-accent)]" aria-label={label} />
    </label>
  )
}

/**
 * The microphone level, with the sensitivity mark drawn on it: everything past the mark is
 * "talking". Drag the slider under it until the mark sits just above your background noise.
 */
function LevelMeter({ db, thresholdDb, active }: { db: number; thresholdDb: number | null; active: boolean }): React.JSX.Element {
  const level = dbToUnit(db)
  const over = thresholdDb !== null && db >= thresholdDb
  return (
    <div className="relative h-3 overflow-hidden rounded-full bg-white/8" role="meter" aria-label="Microphone level" aria-valuemin={-100} aria-valuemax={0} aria-valuenow={Math.round(db)} data-mic-meter>
      <div className={cn('voice-meter-fill h-full rounded-full', !active ? 'bg-white/10' : over || thresholdDb === null ? 'bg-emerald-400' : 'bg-amber-400/80')} style={{ width: `${active ? level * 100 : 0}%` }} />
      {thresholdDb !== null && <div className="absolute inset-y-[-2px] w-0.5 bg-white shadow-[0_0_4px_rgb(0_0_0)]" style={{ left: `${dbToUnit(thresholdDb) * 100}%` }} aria-hidden />}
    </div>
  )
}

/** Records the push-to-talk key: click, then press a key or a mouse side button. */
function KeyRecorder({ value, onChange }: { value: VoiceSettings['pttKey']; onChange: (b: VoiceSettings['pttKey']) => void }): React.JSX.Element {
  const [recording, setRecording] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!recording) return
    const key = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape') return setRecording(false)
      onChange({ kind: 'key', code: e.code, label: keyLabel(e.code) })
      setRecording(false)
    }
    const mouse = (e: MouseEvent): void => {
      const b = mouseBinding(e.button)
      if (!b) return
      e.preventDefault()
      e.stopPropagation()
      onChange(b)
      setRecording(false)
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('mousedown', mouse, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('mousedown', mouse, true)
    }
  }, [recording, onChange])
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
      <span className="min-w-0 flex-1 text-sm">
        Push-to-talk key
        <span className="block text-xs text-muted">Click, then press any key or a mouse side button. Esc cancels.</span>
      </span>
      <button
        ref={button}
        onClick={() => setRecording((r) => !r)}
        data-ptt-recorder
        className={cn(
          'flex h-11 min-w-36 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold transition',
          recording ? 'animate-pulse border-accent bg-accent/15 text-accent' : 'border-border bg-surface-2 hover:border-white/25'
        )}
      >
        <Keyboard className="size-4" /> {recording ? 'Press a key…' : (value?.label ?? 'Not set')}
      </button>
      {value && !recording && (
        <button onClick={() => onChange(null)} className="text-xs text-muted transition hover:text-text">
          Clear
        </button>
      )}
    </div>
  )
}

/** Settings → Voice. */
export function VoiceSettingsPanel({ settings: initial }: { settings: VoiceSettings }): React.JSX.Element {
  // The shared settings store: a change saved here (or in a call) shows at once.
  const settings = useSettings()?.voice ?? initial
  const v = useVoice()
  const db = useMicLevel()
  const [devices, setDevices] = useState<AudioDevices | null>(null)
  const [testing, setTesting] = useState(false)
  const [hearMe, setHearMe] = useState(false)
  const [hotkey, setHotkey] = useState<{ global: boolean; message: string | null } | null>(null)
  // Sliders follow the finger at once and are saved when let go.
  const [draft, setDraft] = useState<Partial<VoiceSettings>>({})
  const s = { ...settings, ...draft }
  const phone = isAndroid()
  const inCall = v.status === 'in-room' || v.status === 'reconnecting'

  const refreshDevices = (): void => void voice.devices().then(setDevices, () => {})
  useEffect(() => {
    refreshDevices()
    void window.vanity.voice.hotkeyStatus().then(setHotkey, () => {})
    const onChange = (): void => refreshDevices()
    navigator.mediaDevices?.addEventListener('devicechange', onChange)
    return () => {
      navigator.mediaDevices?.removeEventListener('devicechange', onChange)
      voice.stopMicTest()
    }
  }, [])

  const save = (patch: Partial<VoiceSettings>): void => {
    setDraft({})
    void saveVoiceSettings(patch)
  }
  // Hear (and see) a slider's change straight away; it's saved when the slider is let go.
  const live = (patch: Partial<VoiceSettings>): void => {
    setDraft((d) => ({ ...d, ...patch }))
    previewVoiceSettings(patch)
  }
  const commit = (): void => {
    if (Object.keys(draft).length) save(draft)
  }

  const startTest = async (): Promise<void> => {
    setTesting(true)
    await voice.startMicTest()
    refreshDevices() // names appear once the microphone is allowed
  }
  const stopTest = (): void => {
    setTesting(false)
    setHearMe(false)
    voice.stopMicTest()
  }

  const missingNames = devices && devices.inputs.length > 0 && devices.inputs.every((d) => /^Microphone \d+$/.test(d.label))
  const metering = testing || inCall

  return (
    <>
      <Section title="Microphone and speakers">
        <div className="grid gap-3 px-3 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1.5 flex items-center gap-2 text-muted">
              <Mic className="size-4" /> Microphone
            </span>
            <select value={s.inputDeviceId} onChange={(e) => save({ inputDeviceId: e.target.value })} className={select} data-input-device>
              <option value="">System default</option>
              {devices?.inputs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
              {s.inputDeviceId && devices && !devices.inputs.some((d) => d.id === s.inputDeviceId) && <option value={s.inputDeviceId}>Unplugged microphone (default is used)</option>}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1.5 flex items-center gap-2 text-muted">
              <Headphones className="size-4" /> Speakers or headset
            </span>
            <select value={s.outputDeviceId} onChange={(e) => save({ outputDeviceId: e.target.value })} className={select} disabled={devices?.canPickOutput === false} data-output-device>
              <option value="">System default</option>
              {devices?.outputs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
              {s.outputDeviceId && devices && !devices.outputs.some((d) => d.id === s.outputDeviceId) && <option value={s.outputDeviceId}>Unplugged device (default is used)</option>}
            </select>
          </label>
        </div>
        {devices && devices.inputs.length === 0 && <p className="mx-3 mt-3 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-200">No microphone found. Plug one in: it shows up here by itself.</p>}
        {missingNames && <p className="mx-3 mt-3 text-xs text-muted">Device names show once Vanity is allowed to use the microphone: start the test below.</p>}
        <p className="mx-3 mt-2 text-xs text-muted">If a device is unplugged during a call, Vanity switches to the default one and back again when it returns.</p>
        <div className="mt-2 grid md:grid-cols-2">
          <Slider label="Microphone volume" value={Math.round(s.inputVolume * 100)} min={0} max={200} step={5} format={(x) => `${x}%`} onChange={(x) => live({ inputVolume: x / 100 })} onCommit={commit} />
          <Slider label="Output volume" value={Math.round(s.outputVolume * 100)} min={0} max={200} step={5} format={(x) => `${x}%`} onChange={(x) => live({ outputVolume: x / 100 })} onCommit={commit} />
        </div>
      </Section>

      <Section title="Mic test" description="Talk normally and watch the bar. In voice activity mode, the white mark is the sensitivity: anything past it is sent.">
        <div className="px-3">
          <div className="flex items-center gap-3">
            <Button variant={testing ? 'secondary' : 'primary'} onClick={() => (testing ? stopTest() : void startTest())} data-mic-test>
              {testing ? <Square className="size-4" /> : <Play className="size-4" />} {testing ? 'Stop test' : inCall ? 'Show my level' : 'Start test'}
            </Button>
            <div className="min-w-0 flex-1">
              <LevelMeter db={db} thresholdDb={s.inputMode === 'voice' ? s.sensitivityDb : null} active={metering} />
            </div>
            <span className="w-14 text-right text-xs tabular-nums text-muted">{metering ? `${Math.round(db)} dB` : '—'}</span>
          </div>
          {testing && !inCall && (
            <div className="mt-3">
              <Toggle
                checked={hearMe}
                onChange={(on) => {
                  setHearMe(on)
                  voice.setMonitor(on)
                }}
                label="Let me hear myself"
                hint="Use headphones, or your speakers will feed back into the microphone."
              />
            </div>
          )}
          {v.notice && testing && <p className="mt-2 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-200">{v.notice}</p>}
        </div>
      </Section>

      <Section title="How you talk">
        <div className="flex flex-wrap gap-2 px-3" role="radiogroup" aria-label="Input mode">
          {(
            [
              ['voice', 'Voice activity', "You're heard whenever you talk."],
              ['ptt', 'Push to talk', "You're heard only while you hold a key."]
            ] as const
          ).map(([id, label, hint]) => (
            <button
              key={id}
              role="radio"
              aria-checked={s.inputMode === id}
              onClick={() => save({ inputMode: id })}
              className={cn('min-w-48 flex-1 rounded-xl border px-4 py-3 text-left transition', s.inputMode === id ? 'border-accent bg-accent/10 ring-2 ring-accent/30' : 'border-border hover:border-white/25')}
            >
              <span className="block text-sm font-semibold">{label}</span>
              <span className="block text-xs text-muted">{hint}</span>
            </button>
          ))}
        </div>
        {s.inputMode === 'voice' ? (
          <div className="mt-2">
            <Slider
              label="Sensitivity"
              hint="Lower picks up quieter speech; raise it if keyboard clicks or background noise get through. The mark on the meter above moves with it."
              value={s.sensitivityDb}
              min={-100}
              max={0}
              step={1}
              format={(x) => `${x} dB`}
              onChange={(x) => live({ sensitivityDb: x })}
              onCommit={commit}
            />
            <div className="px-3">
              <LevelMeter db={db} thresholdDb={s.sensitivityDb} active={metering} />
              {!metering && <p className="mt-1.5 text-xs text-muted">Start the mic test to see your level against it.</p>}
            </div>
          </div>
        ) : (
          <div className="mt-2">
            {phone ? (
              <p className="px-3 text-sm text-muted">On a phone, hold the "Hold to talk" button on the voice screen.</p>
            ) : (
              <>
                <KeyRecorder value={s.pttKey} onChange={(b) => save({ pttKey: b })} />
                {hotkey && (
                  <p className={cn('mx-3 rounded-lg px-3 py-2 text-xs', hotkey.global ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-200')} data-hotkey-status>
                    {hotkey.global ? 'This key works even while a game is in front. (A game run as administrator needs Vanity run as administrator too.)' : hotkey.message}
                  </p>
                )}
                {!s.pttKey && <p className="mx-3 mt-2 text-xs text-muted">No key set yet: until you pick one, use the "Hold to talk" button on the voice page.</p>}
              </>
            )}
            <Slider label="Release delay" hint="Keeps sending this long after you let go, so your last word isn't cut off." value={s.pttReleaseMs} min={0} max={1000} step={20} format={(x) => `${x} ms`} onChange={(x) => live({ pttReleaseMs: x })} onCommit={commit} />
          </div>
        )}
      </Section>

      <Section title="Sound processing" description="Cleans up your microphone before it's sent. Changes apply at once, in a call too.">
        <Toggle checked={s.noiseSuppression} onChange={(on) => save({ noiseSuppression: on })} label="Noise suppression" hint="Turns down steady background noise: fans, hum, keyboards." />
        <Toggle checked={s.echoCancellation} onChange={(on) => save({ echoCancellation: on })} label="Echo cancellation" hint="Stops others hearing themselves through your speakers." />
        <Toggle checked={s.autoGainControl} onChange={(on) => save({ autoGainControl: on })} label="Automatic gain control" hint="Evens out your volume when you lean in or away." />
      </Section>

      <Section title="Other">
        <Toggle checked={s.soundEffects} onChange={(on) => save({ soundEffects: on })} label="Sounds" hint="A short tone when people join or leave, and when you mute or deafen." />
        {Object.keys(s.userVolumes).length > 0 && (
          <div className="flex items-center justify-between px-3 py-2.5 text-sm">
            <span>
              Volumes you set for people
              <span className="block text-xs text-muted">{Object.keys(s.userVolumes).length} remembered</span>
            </span>
            <Button onClick={() => save({ userVolumes: {} })}>
              <RotateCcw className="size-4" /> Reset all
            </Button>
          </div>
        )}
      </Section>
    </>
  )
}
