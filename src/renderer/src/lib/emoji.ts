// Emoji for the chat picker, by group. They are ordinary text characters, so they are sent and
// saved like any other letter, and show on every device (Windows draws them with its own font).

export interface EmojiGroup {
  id: string
  label: string
  /** Shown on the group's tab. */
  icon: string
  emoji: string[]
}

const split = (s: string): string[] => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map((x) => x.segment).filter((x) => x.trim())

export const EMOJI_GROUPS: EmojiGroup[] = [
  {
    id: 'smileys',
    label: 'Smileys',
    icon: '😀',
    emoji: split('😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗☺️😚😙🥲😋😛😜🤪😝🤑🤗🤭🫢🤫🤔🫡🤐🤨😐😑😶😏😒🙄😬😮‍💨🤥😌😔😪🤤😴😷🤒🤕🤢🤮🤧🥵🥶🥴😵😵‍💫🤯🤠🥳🥸😎🤓🧐😕🫤😟🙁☹️😮😯😲😳🥺🥹😦😧😨😰😥😢😭😱😖😣😞😓😩😫🥱😤😡😠🤬😈👿💀☠️💩🤡👹👺👻👽👾🤖😺😸😹😻😼😽🙀😿😾')
  },
  {
    id: 'gestures',
    label: 'Gestures',
    icon: '👍',
    emoji: split('👋🤚🖐️✋🖖🫱🫲👌🤌🤏✌️🤞🫰🤟🤘🤙👈👉👆🖕👇☝️🫵👍👎✊👊🤛🤜👏🙌🫶👐🤲🤝🙏✍️💅🤳💪🦾🦵🦶👂🦻👃🧠👀👁️👅👄🫦🙈🙉🙊')
  },
  {
    id: 'hearts',
    label: 'Hearts',
    icon: '❤️',
    emoji: split('❤️🧡💛💚💙💜🤎🖤🤍🩷🩵🩶❤️‍🔥❤️‍🩹💔❣️💕💞💓💗💖💘💝💟💯💢💥💫💦💨🕳️💬👁️‍🗨️🗨️🗯️💭💤✨🌟⭐🔥⚡🌈')
  },
  {
    id: 'gaming',
    label: 'Gaming',
    icon: '🎮',
    emoji: split('🎮🕹️👾🎯🎲🧩♟️🃏🀄🎰🏆🥇🥈🥉🏅🎖️⚔️🗡️🛡️🏹🔫💣🧨🪓🔮🪄🧙🧝🧛🧟🥷🦸🦹👑💎🪙💰🗺️🧭🏰🐉🐲👹🤺🏁🚩🎉🎊🎁🎈⏱️⌛🔋🪫💾💿🖥️💻⌨️🖱️🎧🎤📺📷📱')
  },
  {
    id: 'animals',
    label: 'Animals',
    icon: '🐱',
    emoji: split('🐶🐱🐭🐹🐰🦊🐻🐼🐻‍❄️🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🐤🦆🦅🦉🦇🐺🐗🐴🦄🐝🪲🦋🐌🐞🐢🐍🦎🦖🦕🐙🦑🦀🐡🐠🐟🐬🐳🦈🐊🐅🦓🦍🐘🦒🦘🐿️🦔🌵🌲🌴🍀🍁🍄🌸🌻🌹🌷🌙☀️⛅❄️☃️🌊🌋')
  },
  {
    id: 'food',
    label: 'Food',
    icon: '🍕',
    emoji: split('🍏🍎🍐🍊🍋🍌🍉🍇🍓🫐🍒🍑🥭🍍🥥🥝🍅🥑🌶️🌽🥕🥐🍞🧀🥚🍳🥓🍔🍟🍕🌭🥪🌮🌯🍝🍜🍣🍱🥟🍤🍙🍚🍦🍩🍪🎂🍰🧁🍫🍬🍭🍿🥤🧋☕🍵🍺🍻🥂🍷🧃🧊')
  },
  {
    id: 'activities',
    label: 'Activities',
    icon: '⚽',
    emoji: split('⚽🏀🏈⚾🥎🎾🏐🏉🥏🎱🏓🏸🏒🏑🥍🏏⛳🪁🎣🥊🥋⛸️🎿🛷🏂🏋️🤸⛹️🤾🏌️🏄🏊🚴🧗🏎️🏍️🚗🚀✈️🛸⛵🎸🎹🥁🎺🎷🎻🎬🎨🎭📚✏️📝📌📎🔑🔒🔔📣⏰💡🧪⚙️🔧🔨🧲🎵🎶')
  },
  {
    id: 'symbols',
    label: 'Symbols',
    icon: '✅',
    emoji: split('✅☑️✔️❌❎➕➖➗✖️❓❔❗❕‼️⁉️⚠️🚫⛔🔞📵🔴🟠🟡🟢🔵🟣🟤⚫⚪🟥🟧🟨🟩🟦🟪⬛⬜🔶🔷🔸🔹▶️⏸️⏹️⏺️⏭️⏮️🔁🔀🔼🔽⬆️⬇️⬅️➡️↩️↪️🆗🆕🆒🆓🆙🆘🔝🔜💤♻️🏳️🏴🏳️‍🌈')
  }
]

/** The ones you used last, first. Kept on this device. */
const RECENT_KEY = 'vanity:emoji-recent'
export function recentEmoji(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 24) : []
  } catch {
    return []
  }
}
export function rememberEmoji(e: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([e, ...recentEmoji().filter((x) => x !== e)].slice(0, 24)))
  } catch {
    // Not kept: the picker still works.
  }
}

/** Common typed faces, turned into emoji as you type them followed by a space. */
export const EMOTICONS: Record<string, string> = {
  ':)': '🙂',
  ':-)': '🙂',
  ':D': '😄',
  ':-D': '😄',
  'xD': '😆',
  'XD': '😆',
  ';)': '😉',
  ';-)': '😉',
  ':(': '🙁',
  ':-(': '🙁',
  ":'(": '😢',
  ':P': '😛',
  ':p': '😛',
  ':O': '😮',
  ':o': '😮',
  '<3': '❤️',
  '</3': '💔',
  ':|': '😐',
  'B)': '😎',
  ':*': '😘',
  '^^': '😊',
  ':/': '😕'
}

/**
 * Replaces a typed face just before the cursor with its emoji, once a space follows it
 * (so a web address or a time like 12:30 is never touched). Returns null when there is nothing to replace.
 */
export function replaceEmoticon(text: string, cursor: number): { text: string; cursor: number } | null {
  if (text[cursor - 1] !== ' ') return null
  const before = text.slice(0, cursor - 1)
  for (const [face, emoji] of Object.entries(EMOTICONS)) {
    if (!before.endsWith(face)) continue
    const start = before.length - face.length
    // Only a face on its own: at the start, or after a space or a new line.
    if (start > 0 && !/\s/.test(before[start - 1])) continue
    const next = text.slice(0, start) + emoji + ' ' + text.slice(cursor)
    return { text: next, cursor: start + emoji.length + 1 }
  }
  return null
}

/** A message that is only one to three emoji (and spaces) is shown big. */
export function bigEmoji(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 40) return false
  const parts = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(t)].map((x) => x.segment).filter((x) => x.trim())
  return parts.length >= 1 && parts.length <= 3 && parts.every((p) => /\p{Extended_Pictographic}/u.test(p) || /^\p{Regional_Indicator}{2}$/u.test(p))
}
