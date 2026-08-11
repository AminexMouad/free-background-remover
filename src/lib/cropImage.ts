/** A crop selection expressed as fractions (0–1) of the image's rendered size. */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export const FULL_RECT: CropRect = { x: 0, y: 0, width: 1, height: 1 }

/**
 * Crops an already-loaded `<img>` element down to `rect` (fractions of the
 * image's natural size) and returns a PNG blob. Drawing onto a freshly
 * created canvas without filling a background color preserves the source's
 * alpha channel, so transparent pixels stay transparent.
 */
export async function cropImageToPng(img: HTMLImageElement, rect: CropRect): Promise<Blob> {
  const naturalWidth = img.naturalWidth
  const naturalHeight = img.naturalHeight

  const sx = Math.min(Math.max(Math.round(rect.x * naturalWidth), 0), naturalWidth - 1)
  const sy = Math.min(Math.max(Math.round(rect.y * naturalHeight), 0), naturalHeight - 1)
  const sw = Math.max(1, Math.min(Math.round(rect.width * naturalWidth), naturalWidth - sx))
  const sh = Math.max(1, Math.min(Math.round(rect.height * naturalHeight), naturalHeight - sy))

  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D context is not available.')
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to encode cropped image.'))
    }, 'image/png')
  })
}
