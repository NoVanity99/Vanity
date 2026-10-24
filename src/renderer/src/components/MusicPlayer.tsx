import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, Music2, Pause, Play, Volume1, Volume2, VolumeX } from 'lucide-react'
import type { MusicState } from '@shared/ipc'
import { cn } from '@/lib/cn'
import { shuffledIndices } from '@/lib/shuffle'
import { saveSettings, useSettings } from '@/state/settings'
import { useToast } from '@/state/toasts'

/** Stop after this many unplayable files in a row, so a broken folder can't loop forever. */
const MAX_FAILURES = 5

/**
 * Mini player for the title bar. Play shuffles everything in the music folder
 * and keeps going; songs are never listed or named, by design.
 */
export function MusicPlayer(): React.JSX.Element {
  const toast = useToast()
  const settings = useSettings()
  const audio = useRef<HTMLAudioElement | null>(null)
  const queue = useRef<number[]>([])
  const failures = useRef(0)
  const [lib, setLib] = useState<MusicState | null>(null)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.5)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    window.vanity.music.state().then(setLib, () => {})
  }, [])

  useEffect(() => {
    if (settings) setVolume(settings.musicVolume ?? 0.5)
  }, [settings?.musicVolume]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (audio.current) audio.current.volume = volume
  }, [volume])

  const playNext = useCallback(() => {
    const el = audio.current
    if (!el || !lib || lib.count === 0) return
    if (queue.current.length === 0) queue.current = shuffledIndices(lib.count)
    const next = queue.current.shift()!
    el.src = `vanity-music://track/${next}?v=${lib.version}`
    void el.play().catch(() => {
      // Autoplay or decode problems surface as an 'error' event too; nothing else to do here.
    })
  }, [lib])

  // A single <audio> element for the whole app session.
  useEffect(() => {
    const el = new Audio()
    el.preload = 'auto'
    audio.current = el
    return () => {
      el.pause()
      el.removeAttribute('src')
    }
  }, [])

  useEffect(() => {
    const el = audio.current
    if (!el) return
    const onEnded = (): void => {
      failures.current = 0
      playNext()
    }
    const onError = (): void => {
      if (!el.getAttribute('src')) return
      failures.current += 1
      if (failures.current >= MAX_FAILURES) {
        el.pause()
        setPlaying(false)
        toast("Couldn't play the files in your music folder.", 'error')
        return
      }
      playNext()
    }
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)
    const onPlaying = (): void => {
      failures.current = 0
    }
    el.addEventListener('ended', onEnded)
    el.addEventListener('error', onError)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('playing', onPlaying)
    return () => {
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('error', onError)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('playing', onPlaying)
    }
  }, [playNext, toast])

  const pickFolder = async (): Promise<void> => {
    const state = await window.vanity.music.pickFolder().catch(() => null)
    if (!state) return
    setLib(state)
    // A new folder means a new shuffle.
    queue.current = []
    audio.current?.pause()
    audio.current?.removeAttribute('src')
    setPlaying(false)
    toast(state.count ? `Found ${state.count} song${state.count === 1 ? '' : 's'}` : 'No music files found in that folder', state.count ? 'info' : 'error')
  }

  const toggle = (): void => {
    const el = audio.current
    if (!el || !lib) return
    if (lib.count === 0) {
      void pickFolder()
      return
    }
    if (playing) {
      el.pause()
    } else if (el.getAttribute('src')) {
      void el.play().catch(() => {})
    } else {
      // Fresh start: shuffle everything.
      queue.current = shuffledIndices(lib.count)
      failures.current = 0
      playNext()
    }
  }

  const changeVolume = (v: number): void => {
    setVolume(v)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void saveSettings({ musicVolume: v }).catch(() => {}), 400)
  }

  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const hasMusic = (lib?.count ?? 0) > 0

  return (
    <div
      className="group/music flex h-7 items-center gap-1 rounded-full border border-white/10 bg-black/30 pl-1 pr-2 backdrop-blur [-webkit-app-region:no-drag]"
      aria-label="Music player"
    >
      <button
        onClick={toggle}
        title={hasMusic ? (playing ? 'Pause' : 'Play (shuffle)') : 'Choose a music folder'}
        className={cn(
          'flex size-5 items-center justify-center rounded-full transition hover:scale-110',
          playing ? 'bg-accent text-white shadow-[0_0_10px_var(--color-accent)]' : 'bg-white/10 text-text'
        )}
      >
        {playing ? <Pause className="size-3 fill-current" /> : hasMusic ? <Play className="ml-px size-3 fill-current" /> : <Music2 className="size-3" />}
      </button>

      {/* Equalizer: moves while playing, rests when paused. */}
      <span className="flex h-3 items-end gap-[2px] px-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn('w-[2px] origin-bottom rounded-full bg-accent', playing ? 'h-full' : 'h-1 opacity-50')}
            style={playing ? { animation: `eq ${0.7 + i * 0.17}s ease-in-out ${i * 0.11}s infinite` } : undefined}
          />
        ))}
      </span>

      <span className="flex items-center overflow-hidden">
        <VolumeIcon className="size-3.5 shrink-0 text-muted" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => changeVolume(Number(e.target.value))}
          aria-label="Music volume"
          className="ml-0 h-1 w-0 cursor-pointer accent-accent opacity-0 transition-all duration-300 group-hover/music:ml-1.5 group-hover/music:w-16 group-hover/music:opacity-100"
        />
      </span>

      <button onClick={pickFolder} title={lib?.folder ? `Music folder: ${lib.folder}` : 'Choose a music folder'} className="ml-1 text-muted transition hover:text-text">
        <FolderOpen className="size-3.5" />
      </button>
    </div>
  )
}
