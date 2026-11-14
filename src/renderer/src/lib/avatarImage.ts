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

/** Crops the middle square, shrinks it to 160×160 and returns it as a JPEG data: address. */
export async function toAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error("That file isn't a picture. Choose a PNG or JPEG.")
  const img = await load(file)
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  if (!side) throw new Error("That picture is empty. Try another one.")
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not prepare the picture. Try another one.')
  // A see-through picture gets a dark background instead of black blotches.
  ctx.fillStyle = '#12141b'
  ctx.fillRect(0, 0, SIZE, SIZE)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE)
  for (const quality of [0.86, 0.7, 0.5]) {
    const data = canvas.toDataURL('image/jpeg', quality)
    if (data.startsWith('data:image/jpeg;base64,') && data.length <= MAX_CHARS) return data
  }
  throw new Error('Could not make that picture small enough. Try another one.')
}
