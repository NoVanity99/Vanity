// Turns a picture the user picked into a small square profile picture.

const SIZE = 160
/** What the server accepts (it stores the picture as a data: address). */
const MAX_CHARS = 58_000

function load(file: File): Promise<HTMLImageElement> {
  const unreadable = new Error("That file isn't a picture Vanity can read. Try a PNG or JPEG.")
  return new Promise((resolve, reject) => {
    // Read as a data: address (the app's security policy allows those for images, not blob: ones).
    const reader = new FileReader()
    reader.onerror = () => reject(unreadable)
    reader.onload = () => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(unreadable)
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

/** A square part of a picture, in the picture's own pixels. */
export interface Crop {
  x: number
  y: number
  side: number
}

/** Reads a picture the user picked, ready to be cropped. */
export async function loadPicture(file: File): Promise<HTMLImageElement> {
  if (!file.type.startsWith('image/')) throw new Error("That file isn't a picture. Choose a PNG or JPEG.")
  const img = await load(file)
  if (!Math.min(img.naturalWidth, img.naturalHeight)) throw new Error('That picture is empty. Try another one.')
  return img
}

/** The biggest square in the middle of a picture. */
export const middleCrop = (img: { naturalWidth: number; naturalHeight: number }): Crop => {
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  return { x: (img.naturalWidth - side) / 2, y: (img.naturalHeight - side) / 2, side }
}

/** Turns a canvas into the small JPEG data: address the server accepts. */
function encode(canvas: HTMLCanvasElement): string {
  for (const quality of [0.86, 0.7, 0.5]) {
    const data = canvas.toDataURL('image/jpeg', quality)
    if (data.startsWith('data:image/jpeg;base64,') && data.length <= MAX_CHARS) return data
  }
  throw new Error('Could not make that picture small enough. Try another one.')
}

function blank(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not prepare the picture. Try another one.')
  return { canvas, ctx }
}

/** Cuts the chosen square out of a picture, shrinks it to 160×160 and returns it as a JPEG data: address. */
export function cropAvatar(img: HTMLImageElement, crop: Crop = middleCrop(img)): string {
  const { canvas, ctx } = blank()
  // A see-through picture gets a dark background instead of black blotches.
  ctx.fillStyle = '#12141b'
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, crop.x, crop.y, crop.side, crop.side, 0, 0, SIZE, SIZE)
  return encode(canvas)
}

/** Crops the middle square, shrinks it to 160×160 and returns it as a JPEG data: address. */
export async function toAvatar(file: File): Promise<string> {
  return cropAvatar(await loadPicture(file))
}

/** A ready-made picture: two colours and a symbol. The same list is offered in Account and when signing up. */
export interface DefaultAvatar {
  id: string
  label: string
  from: string
  to: string
  symbol: string
}

export const DEFAULT_AVATARS: DefaultAvatar[] = [
  { id: 'ember', label: 'Ember', from: '#ff5f6d', to: '#7a1f3d', symbol: '🎮' },
  { id: 'ocean', label: 'Ocean', from: '#36d1dc', to: '#2a4d9c', symbol: '🕹️' },
  { id: 'forest', label: 'Forest', from: '#56ab2f', to: '#14532d', symbol: '🐉' },
  { id: 'sunset', label: 'Sunset', from: '#f7971e', to: '#b0305c', symbol: '🔥' },
  { id: 'violet', label: 'Violet', from: '#a18cd1', to: '#4a2a8c', symbol: '👾' },
  { id: 'night', label: 'Night', from: '#3a4a6b', to: '#0f1424', symbol: '🌙' },
  { id: 'gold', label: 'Gold', from: '#f6d365', to: '#a86b12', symbol: '🏆' },
  { id: 'mint', label: 'Mint', from: '#43e97b', to: '#0f766e', symbol: '🍀' },
  { id: 'rose', label: 'Rose', from: '#ff9a9e', to: '#b0305c', symbol: '🦊' },
  { id: 'storm', label: 'Storm', from: '#667eea', to: '#1e2a5a', symbol: '⚡' },
  { id: 'steel', label: 'Steel', from: '#8e9eab', to: '#2c3e50', symbol: '🎧' },
  { id: 'cosmic', label: 'Cosmic', from: '#fc5c7d', to: '#3a1c71', symbol: '🚀' }
]

/** Draws a ready-made picture as the same kind of small JPEG an uploaded one becomes. */
export function defaultAvatar(def: DefaultAvatar): string {
  const { canvas, ctx } = blank()
  const fill = ctx.createLinearGradient(0, 0, SIZE, SIZE)
  fill.addColorStop(0, def.from)
  fill.addColorStop(1, def.to)
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.font = `${SIZE * 0.5}px "Segoe UI Emoji", "Noto Color Emoji", "Apple Color Emoji", sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(def.symbol, SIZE / 2, SIZE / 2 + SIZE * 0.03)
  return encode(canvas)
}
