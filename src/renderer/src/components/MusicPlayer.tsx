import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FolderOpen, Music2, Pause, Play, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react'
import type { MusicState } from '@shared/ipc'
import type { TrackInfo } from '@shared/types'
import { cn } from '@/lib/cn'
import { shuffledIndices } from '@/lib/shuffle'
import { saveSettings, useSettings } from '@/state/settings'
import { useToast } from '@/state/toasts'

/** Stop after this many unplayable files in a row, so a broken folder can't loop forever. */
const MAX_FAILURES = 5
/** "Previous" restarts the song instead when it's been playing longer than this. */
const RESTART_AFTER_S = 3
const HISTORY = 100

/** One line of text that scrolls slowly when it doesn't fit. */
function ScrollingText({ text, className }: { text: string; className?: string }): React.JSX.Element {
  const box = useRef<HTMLSpanElement>(null)
  const inner = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(false)
  useLayoutEffect(() => {
    setOverflow(!!box.current && !!inner.current && inner.current.scrollWidth > box.current.clientWidth + 1)
  }, [text])
  return (
    <span ref={box} className={cn('marquee block overflow-hidden whitespace-nowrap', overflow && '[mask-image:linear-gradient(to_right,transparent,black_8px,black_calc(100%-12px),transparent)]', className)}>
      {overflow ? (
        <span className="animate-marquee inline-flex w-max" style={{ '--marquee-duration': `${Math.max(8, text.length * 0.35)}s` } as React.CSSProperties}>
          <span className="pr-8">{text}</span>
          <span className="pr-8" aria-hidden>
            {text}
          </span>
        </span>
      ) : (
        <span ref={inner}>{text}</span>
      )}
    </span>
  )
}

/**
 * Slim player in the title bar: artwork, song, previous / play / next and
 * volume. Play shuffles everything in the music folder and keeps going.
 */
export function MusicPlayer(): React.JSX.Element {
  const toast = useToast()
  const settings = useSettings()
  const audio = useRef<HTMLAudioElement | null>(null)
  const queue = useRef<number[]>([])
  const history = useRef<number[]>([])
  const failures = useRef(0)
  const [lib, setLib] = useState<MusicState | null>(null)
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.5)
  const [current, setCurrent] = useState<number | null>(null)
  const [info, setInfo] = useState<TrackInfo | null>(null)
  const [artFailed, setArtFailed] = useState(false)
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

  // Song title and artwork for whatever is playing.
  useEffect(() => {
    setArtFailed(false)
    if (current === null) return setInfo(null)
    let cancelled = false
    window.vanity.music.track(current).then((i) => !cancelled && setInfo(i), () => {})
    return () => {
      cancelled = true
    }
  }, [current, lib?.version])

  const playIndex = useCallback(
    (index: number) => {
      const el = audio.current
      if (!el || !lib) return
      el.src = `vanity-music://track/${index}?v=${lib.version}`
      setCurrent(index)
      void el.play().catch(() => {
        // Autoplay or decode problems surface as an 'error' event too; nothing else to do here.
      })
    },
    [lib]
  )

  const playNext = useCallback(() => {
    if (!lib || lib.count === 0) return
    if (queue.current.length === 0) queue.current = shuffledIndices(lib.count)
    if (current !== null) history.current = [...history.current, current].slice(-HISTORY)
    playIndex(queue.current.shift()!)
  }, [lib, current, playIndex])

  const playPrevious = (): void => {
    const el = audio.current
    if (!el) return
    const prev = history.current.at(-1)
    if (el.currentTime > RESTART_AFTER_S || prev === undefined) {
      el.currentTime = 0
      if (el.paused && el.getAttribute('src')) void el.play().catch(() => {})
      return
    }
    history.current = history.current.slice(0, -1)
    // The song we're leaving comes back next.
    if (current !== null) queue.current.unshift(current)
    playIndex(prev)
  }

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
    history.current = []
    audio.current?.pause()
    audio.current?.removeAttribute('src')
    setPlaying(false)
    setCurrent(null)
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

  // Keyboard media keys (and Windows' media overlay) control the player too.
  const handlers = useRef({ toggle, playNext, playPrevious })
  handlers.current = { toggle, playNext, playPrevious }
  useEffect(() => {
    const ms = navigator.mediaSession
    if (!ms) return
    ms.setActionHandler('play', () => handlers.current.toggle())
    ms.setActionHandler('pause', () => handlers.current.toggle())
    ms.setActionHandler('nexttrack', () => handlers.current.playNext())
    ms.setActionHandler('previoustrack', () => handlers.current.playPrevious())
  }, [])
  useEffect(() => {
    if (navigator.mediaSession && info) navigator.mediaSession.metadata = new MediaMetadata({ title: info.title, artist: info.artist ?? '', album: info.album ?? '' })
  }, [info])

  const changeVolume = (v: number): void => {
    setVolume(v)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void saveSettings({ musicVolume: v }).catch(() => {}), 400)
  }

  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2
  const hasMusic = (lib?.count ?? 0) > 0
  const started = current !== null
  const label = !hasMusic ? 'Choose a music folder' : info ? (info.artist ? `${info.title} · ${info.artist}` : info.title) : started ? 'Loading…' : 'Press play to shuffle'
  const showArt = started && info?.hasArt && !artFailed && lib

  const iconButton = 'flex size-6 shrink-0 items-center justify-center rounded-full text-text/80 transition hover:scale-110 hover:bg-white/10 hover:text-text disabled:pointer-events-none disabled:opacity-35'

  return (
    <div
      className="flex h-8 items-center gap-1 rounded-full border border-white/10 bg-black/35 py-1 pl-1 pr-2.5 shadow-lg shadow-black/20 backdrop-blur-md [-webkit-app-region:no-drag]"
      aria-label="Music player"
    >
      {/* Artwork (or a placeholder), gently pulsing while playing. */}
      <button
        onClick={pickFolder}
        title={lib?.folder ? `Music folder: ${lib.folder}. Click to change.` : 'Choose a music folder'}
        className="relative size-6 shrink-0 overflow-hidden rounded-full ring-1 ring-white/15 transition hover:scale-105"
      >
        {showArt ? (
          <img
            key={`${lib.version}-${current}`}
            src={`vanity-music://art/${current}?v=${lib.version}`}
            alt=""
            onError={() => setArtFailed(true)}
            className={cn('size-full animate-[fade-in_400ms_ease-out] object-cover', playing && 'animate-[spin_12s_linear_infinite]')}
            draggable={false}
          />
        ) : (
          <span className="flex size-full items-center justify-center bg-gradient-to-br from-accent to-accent-2">
            <Music2 className="size-3 text-white" />
          </span>
        )}
      </button>

      <ScrollingText key={label} text={label} className={cn('ml-1 w-28 text-xs xl:w-44', info ? 'font-medium text-text' : 'text-muted')} />

      <div className="ml-1 flex items-center gap-0.5">
        <button onClick={playPrevious} disabled={!started} title="Previous" aria-label="Previous" className={iconButton}>
          <SkipBack className="size-3.5 fill-current" />
        </button>
        <button
          onClick={toggle}
          title={hasMusic ? (playing ? 'Pause' : 'Play (shuffle)') : 'Choose a music folder'}
          aria-label={playing ? 'Pause' : 'Play'}
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full transition hover:scale-110',
            playing ? 'bg-accent text-white shadow-[0_0_10px_var(--color-accent)]' : 'bg-white/90 text-black'
          )}
        >
          {playing ? <Pause className="size-3 fill-current" /> : hasMusic ? <Play className="ml-px size-3 fill-current" /> : <FolderOpen className="size-3" />}
        </button>
        <button onClick={playNext} disabled={!hasMusic || !started} title="Next" aria-label="Next" className={iconButton}>
          <SkipForward className="size-3.5 fill-current" />
        </button>
      </div>

      <div className="ml-1.5 flex items-center gap-1.5">
        <button onClick={() => changeVolume(volume === 0 ? 0.5 : 0)} title={volume === 0 ? 'Unmute' : 'Mute'} aria-label={volume === 0 ? 'Unmute' : 'Mute'} className="text-muted transition hover:text-text">
          <VolumeIcon className="size-3.5" />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => changeVolume(Number(e.target.value))}
          aria-label="Music volume"
          title={`Volume ${Math.round(volume * 100)}%`}
          className="h-1 w-14 cursor-pointer accent-accent xl:w-20"
        />
      </div>
    </div>
  )
}
