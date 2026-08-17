// Dependency-free mask math for the object selection flow. Everything here
// works on plain Uint8Array masks at a downscaled "analysis" resolution; the
// full-resolution work is left to canvas compositing in objectSelection.ts.

/** Inclusive pixel bounds of a region, in analysis-resolution coordinates. */
export interface RegionBounds {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface ObjectRegion {
  /** Label value inside `ObjectMap.labels`; also the number shown in the UI. */
  id: number
  /** Pixel count at analysis resolution. Regions are sorted largest first. */
  area: number
  bounds: RegionBounds
  centerX: number
  centerY: number
}

export interface ObjectMap {
  width: number
  height: number
  /** One entry per pixel: 0 for background, otherwise an `ObjectRegion.id`. */
  labels: Int32Array
  regions: ObjectRegion[]
}

/** Alpha at or above this counts as foreground when splitting the matte. */
const FOREGROUND_ALPHA = 128
/** Eroding before labeling separates objects joined by a thin bridge. */
const SPLIT_ERODE_RADIUS = 2
/** Grows the keep mask so imgly's feathered hair/edge alpha is not clipped. */
const KEEP_DILATE_RADIUS = 2
/** Beyond this the UI becomes unusable, and the tail is always noise. */
const MAX_REGIONS = 12
/** Blobs smaller than this share of the matte are speckle, not objects. */
const MIN_REGION_FRACTION = 0.004
const MIN_REGION_PIXELS = 80

/**
 * Separable min/max filter. Two 1-D passes are much cheaper than a square
 * kernel and give the same result for the box-shaped structuring element we
 * want here.
 */
function boxFilter(
  source: Uint8Array,
  width: number,
  height: number,
  radius: number,
  keepMax: boolean,
): Uint8Array {
  if (radius <= 0) return source.slice()

  const horizontal = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const from = Math.max(0, x - radius)
      const to = Math.min(width - 1, x + radius)
      let value = source[row + from]
      for (let i = from + 1; i <= to; i++) {
        const candidate = source[row + i]
        value = keepMax ? Math.max(value, candidate) : Math.min(value, candidate)
      }
      horizontal[row + x] = value
    }
  }

  const result = new Uint8Array(width * height)
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const from = Math.max(0, y - radius)
      const to = Math.min(height - 1, y + radius)
      let value = horizontal[from * width + x]
      for (let i = from + 1; i <= to; i++) {
        const candidate = horizontal[i * width + x]
        value = keepMax ? Math.max(value, candidate) : Math.min(value, candidate)
      }
      result[y * width + x] = value
    }
  }
  return result
}

export function erodeMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  return boxFilter(mask, width, height, radius, false)
}

export function dilateMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  return boxFilter(mask, width, height, radius, true)
}

/**
 * Flood-fills every unlabeled `mask` pixel with a fresh label (8-connected),
 * starting at `firstLabel`. Pixels that already carry a label are skipped, so
 * this can be called more than once on the same label buffer. Returns how many
 * new labels were assigned.
 */
function labelComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  labels: Int32Array,
  firstLabel: number,
): number {
  const queue = new Int32Array(width * height)
  let next = firstLabel

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || labels[start] !== 0) continue
    const label = next++
    labels[start] = label
    let head = 0
    let tail = 0
    queue[tail++] = start

    while (head < tail) {
      const index = queue[head++]
      const x = index % width
      const y = (index / width) | 0
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const neighbor = ny * width + nx
          if (mask[neighbor] === 0 || labels[neighbor] !== 0) continue
          labels[neighbor] = label
          queue[tail++] = neighbor
        }
      }
    }
  }
  return next - firstLabel
}

/**
 * Expands the existing labels outwards over `mask` until the whole mask is
 * covered, so the erosion used to split objects does not shrink them. Each
 * pixel goes to whichever label reaches it first, which approximates "nearest
 * object wins".
 */
function growLabels(labels: Int32Array, mask: Uint8Array, width: number, height: number): void {
  const queue = new Int32Array(width * height)
  let head = 0
  let tail = 0
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== 0) queue[tail++] = i
  }

  while (head < tail) {
    const index = queue[head++]
    const label = labels[index]
    const x = index % width
    const y = (index / width) | 0
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy
      if (ny < 0 || ny >= height) continue
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx
        if (nx < 0 || nx >= width) continue
        const neighbor = ny * width + nx
        if (mask[neighbor] === 0 || labels[neighbor] !== 0) continue
        labels[neighbor] = label
        queue[tail++] = neighbor
      }
    }
  }
}

/**
 * Turns a soft alpha matte into a set of candidate objects: threshold to a
 * binary foreground, erode + label to split touching blobs, grow the labels
 * back to the original silhouette, then drop speckle.
 */
export function detectObjects(alpha: Uint8Array, width: number, height: number): ObjectMap {
  const foreground = new Uint8Array(width * height)
  let foregroundArea = 0
  for (let i = 0; i < foreground.length; i++) {
    if (alpha[i] >= FOREGROUND_ALPHA) {
      foreground[i] = 1
      foregroundArea++
    }
  }

  const labels = new Int32Array(width * height)
  const core = erodeMask(foreground, width, height, SPLIT_ERODE_RADIUS)
  let labelCount = labelComponents(core, width, height, labels, 1)
  growLabels(labels, foreground, width, height)

  // Objects thin enough to be erased by the erosion have no seed to grow from,
  // so they are still unlabeled here. Label them directly instead of letting a
  // pen or an outstretched hand silently vanish from the candidate list.
  const leftover = new Uint8Array(width * height)
  let hasLeftover = false
  for (let i = 0; i < labels.length; i++) {
    if (foreground[i] !== 0 && labels[i] === 0) {
      leftover[i] = 1
      hasLeftover = true
    }
  }
  if (hasLeftover) {
    labelCount += labelComponents(leftover, width, height, labels, labelCount + 1)
  }

  const areas = new Int32Array(labelCount + 1)
  const sumX = new Float64Array(labelCount + 1)
  const sumY = new Float64Array(labelCount + 1)
  const minX = new Int32Array(labelCount + 1).fill(width)
  const minY = new Int32Array(labelCount + 1).fill(height)
  const maxX = new Int32Array(labelCount + 1).fill(-1)
  const maxY = new Int32Array(labelCount + 1).fill(-1)

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]
    if (label === 0) continue
    const x = i % width
    const y = (i / width) | 0
    areas[label]++
    sumX[label] += x
    sumY[label] += y
    if (x < minX[label]) minX[label] = x
    if (y < minY[label]) minY[label] = y
    if (x > maxX[label]) maxX[label] = x
    if (y > maxY[label]) maxY[label] = y
  }

  const minArea = Math.max(MIN_REGION_PIXELS, Math.round(foregroundArea * MIN_REGION_FRACTION))
  const candidates: { label: number; region: ObjectRegion }[] = []
  for (let label = 1; label <= labelCount; label++) {
    const area = areas[label]
    if (area < minArea) continue
    candidates.push({
      label,
      region: {
        id: 0,
        area,
        bounds: { x0: minX[label], y0: minY[label], x1: maxX[label], y1: maxY[label] },
        centerX: sumX[label] / area,
        centerY: sumY[label] / area,
      },
    })
  }
  candidates.sort((a, b) => b.region.area - a.region.area)
  const kept = candidates.slice(0, MAX_REGIONS)

  // Renumber so the labels the user sees are 1..N ordered by size, and every
  // dropped blob collapses back to background.
  const remap = new Int32Array(labelCount + 1)
  kept.forEach((candidate, index) => {
    candidate.region.id = index + 1
    remap[candidate.label] = index + 1
  })
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]
    if (label !== 0) labels[i] = remap[label]
  }

  return { width, height, labels, regions: kept.map((candidate) => candidate.region) }
}

/**
 * Region id at an analysis-resolution point, or 0 for background. Clicks near
 * (but not exactly on) an object still hit it, which matters on small previews
 * where one screen pixel covers several mask pixels.
 */
export function regionAt(map: ObjectMap, x: number, y: number, tolerance = 6): number {
  const px = Math.round(x)
  const py = Math.round(y)
  if (px < 0 || py < 0 || px >= map.width || py >= map.height) return 0

  const direct = map.labels[py * map.width + px]
  if (direct !== 0) return direct

  for (let radius = 1; radius <= tolerance; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const ny = py + dy
      if (ny < 0 || ny >= map.height) continue
      for (let dx = -radius; dx <= radius; dx++) {
        // Only walk the ring at this radius; inner points were already checked.
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue
        const nx = px + dx
        if (nx < 0 || nx >= map.width) continue
        const label = map.labels[ny * map.width + nx]
        if (label !== 0) return label
      }
    }
  }
  return 0
}

/**
 * Union of the selected regions as a 0/255 mask, dilated a couple of pixels so
 * that multiplying it into the imgly matte keeps the soft edges rather than
 * cutting a hard line just inside them.
 */
export function buildKeepMask(map: ObjectMap, selected: Iterable<number>): Uint8Array {
  const wanted = new Set(selected)
  const mask = new Uint8Array(map.width * map.height)
  for (let i = 0; i < mask.length; i++) {
    if (wanted.has(map.labels[i])) mask[i] = 255
  }
  return dilateMask(mask, map.width, map.height, KEEP_DILATE_RADIUS)
}
