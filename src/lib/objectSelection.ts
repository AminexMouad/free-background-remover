// Turns the imgly alpha matte into a set of pickable objects and composites the
// user's choice back into a transparent PNG. No extra model is downloaded: the
// candidate objects are the connected blobs of the matte the background remover
// already produces.
import { buildKeepMask, detectObjects, type ObjectMap } from './mask'

/** Masks are analysed at this size at most — enough detail, bounded memory. */
export const ANALYSIS_MAX_DIM = 1024

export interface ObjectPreview {
  /** The plain background-removal result, used by the "keep everything" path. */
  cutout: Blob
  /** The uploaded image, drawn as the preview background. */
  sourceBitmap: ImageBitmap
  /** The cutout, kept around so compositing never re-runs the model. */
  cutoutBitmap: ImageBitmap
  objects: ObjectMap
}

const SCRIM = [12, 10, 26, 110]
const SELECTED_FILL = [56, 214, 235, 66]
const SELECTED_EDGE = [56, 214, 235, 255]
const UNSELECTED_FILL = [12, 10, 26, 80]
const UNSELECTED_EDGE = [255, 255, 255, 190]

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context is not available.')
  return ctx
}

function analysisSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, ANALYSIS_MAX_DIM / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Decodes the upload and its cutout, then labels the cutout's alpha channel
 * into candidate objects. Rejects if the browser cannot decode either image;
 * callers should fall back to the plain cutout in that case.
 */
export async function buildObjectPreview(file: File, cutout: Blob): Promise<ObjectPreview> {
  const [sourceBitmap, cutoutBitmap] = await Promise.all([
    createImageBitmap(file),
    createImageBitmap(cutout),
  ])

  try {
    const size = analysisSize(cutoutBitmap.width, cutoutBitmap.height)
    const canvas = createCanvas(size.width, size.height)
    const ctx = context2d(canvas)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(cutoutBitmap, 0, 0, size.width, size.height)

    const { data } = ctx.getImageData(0, 0, size.width, size.height)
    const alpha = new Uint8Array(size.width * size.height)
    for (let i = 0; i < alpha.length; i++) {
      alpha[i] = data[i * 4 + 3]
    }

    return { cutout, sourceBitmap, cutoutBitmap, objects: detectObjects(alpha, size.width, size.height) }
  } catch (err) {
    sourceBitmap.close()
    cutoutBitmap.close()
    throw err
  }
}

export function releaseObjectPreview(preview: ObjectPreview): void {
  preview.sourceBitmap.close()
  preview.cutoutBitmap.close()
}

/**
 * Paints the highlighter overlay at analysis resolution: kept objects tinted
 * and outlined, other objects dimmed with a soft outline, background darkened.
 * The caller scales the result up onto the on-screen canvas.
 */
export function createOverlayCanvas(
  objects: ObjectMap,
  selected: ReadonlySet<number>,
): HTMLCanvasElement {
  const { width, height, labels } = objects
  const canvas = createCanvas(width, height)
  const ctx = context2d(canvas)
  const image = ctx.createImageData(width, height)

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]
    const x = i % width
    const y = (i / width) | 0

    let color = SCRIM
    if (label !== 0) {
      // A two-pixel band on the inside of the object reads as an outline once
      // the overlay is scaled up to the preview size.
      let isEdge = false
      for (let step = 1; step <= 2 && !isEdge; step++) {
        isEdge =
          (x - step >= 0 && labels[i - step] !== label) ||
          (x + step < width && labels[i + step] !== label) ||
          (y - step >= 0 && labels[i - step * width] !== label) ||
          (y + step < height && labels[i + step * width] !== label) ||
          x - step < 0 ||
          x + step >= width ||
          y - step < 0 ||
          y + step >= height
      }
      const isSelected = selected.has(label)
      if (isSelected) color = isEdge ? SELECTED_EDGE : SELECTED_FILL
      else color = isEdge ? UNSELECTED_EDGE : UNSELECTED_FILL
    }

    const offset = i * 4
    image.data[offset] = color[0]
    image.data[offset + 1] = color[1]
    image.data[offset + 2] = color[2]
    image.data[offset + 3] = color[3]
  }

  ctx.putImageData(image, 0, 0)
  return canvas
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Failed to encode the cutout as PNG.'))
    }, 'image/png')
  })
}

/**
 * Clips the full-resolution cutout to the selected objects. The keep mask is
 * drawn scaled up with smoothing and composited with `destination-in`, so the
 * browser multiplies it into the existing alpha: imgly's feathered hair and
 * edge detail survives, and unselected objects fade out instead of being cut
 * along a jagged mask edge.
 */
export async function composeKeptCutout(
  preview: ObjectPreview,
  selected: ReadonlySet<number>,
): Promise<Blob> {
  const { cutoutBitmap, objects } = preview
  const keep = buildKeepMask(objects, selected)

  const maskCanvas = createCanvas(objects.width, objects.height)
  const maskCtx = context2d(maskCanvas)
  const maskImage = maskCtx.createImageData(objects.width, objects.height)
  for (let i = 0; i < keep.length; i++) {
    const offset = i * 4
    maskImage.data[offset] = 255
    maskImage.data[offset + 1] = 255
    maskImage.data[offset + 2] = 255
    maskImage.data[offset + 3] = keep[i]
  }
  maskCtx.putImageData(maskImage, 0, 0)

  const canvas = createCanvas(cutoutBitmap.width, cutoutBitmap.height)
  const ctx = context2d(canvas)
  ctx.drawImage(cutoutBitmap, 0, 0)
  ctx.globalCompositeOperation = 'destination-in'
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(maskCanvas, 0, 0, canvas.width, canvas.height)

  return canvasToPngBlob(canvas)
}
