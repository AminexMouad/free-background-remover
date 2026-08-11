import { useCallback, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CropRect } from '../lib/cropImage'

/** Smallest crop dimension we allow, as a fraction of the image. Keeps the
 * box from being dragged down to a sliver or a single point. */
const MIN_SIZE = 0.04

type Corner = 'nw' | 'ne' | 'sw' | 'se'

const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se']

function clampRect(rect: CropRect): CropRect {
  const width = Math.min(Math.max(rect.width, 0), 1)
  const height = Math.min(Math.max(rect.height, 0), 1)
  const x = Math.min(Math.max(rect.x, 0), 1 - width)
  const y = Math.min(Math.max(rect.y, 0), 1 - height)
  return { x, y, width, height }
}

interface CropSelectorProps {
  rect: CropRect
  /** Desired crop aspect ratio (width / height in pixels), or null for free-form. */
  aspect: number | null
  /** The underlying image's natural width / natural height. Needed to convert
   * a pixel aspect ratio into the fraction-of-stage space the box is tracked
   * in, since the stage itself is rarely square. */
  imageAspect: number
  onChange: (rect: CropRect) => void
}

/**
 * Draggable/resizable crop box, rendered as an absolutely-positioned overlay
 * sized to fill its parent (which must be `position: relative` and match the
 * displayed image exactly). Coordinates are tracked as fractions of the
 * parent's size, so the box stays correctly placed if the image is resized.
 */
export function CropSelector({ rect, aspect, imageAspect, onChange }: CropSelectorProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  // Fraction-space width/height aren't proportional to pixel width/height
  // unless the image is square, so a desired pixel aspect ratio (e.g. 1:1)
  // has to be re-expressed in fraction space before it can drive the math
  // below: fractionW/fractionH * imageAspect === pixelW/pixelH.
  const fractionAspect = aspect && imageAspect > 0 ? aspect / imageAspect : null

  const fractionFromEvent = useCallback((event: PointerEvent) => {
    const stage = stageRef.current
    if (!stage) return { x: 0, y: 0 }
    const bounds = stage.getBoundingClientRect()
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    }
  }, [])

  const startMove = useCallback(
    (downEvent: ReactPointerEvent<HTMLDivElement>) => {
      downEvent.preventDefault()
      const startRect = rect
      const start = fractionFromEvent(downEvent.nativeEvent)

      const handleMove = (event: PointerEvent) => {
        const point = fractionFromEvent(event)
        const dx = point.x - start.x
        const dy = point.y - start.y
        onChange(
          clampRect({
            x: startRect.x + dx,
            y: startRect.y + dy,
            width: startRect.width,
            height: startRect.height,
          }),
        )
      }
      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
      }
      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
    },
    [fractionFromEvent, onChange, rect],
  )

  const startResize = useCallback(
    (downEvent: ReactPointerEvent<HTMLSpanElement>, corner: Corner) => {
      downEvent.preventDefault()
      downEvent.stopPropagation()
      const startRect = rect
      // The opposite corner stays fixed while the dragged corner moves freely.
      const anchorX = corner.includes('w') ? startRect.x + startRect.width : startRect.x
      const anchorY = corner.includes('n') ? startRect.y + startRect.height : startRect.y

      const handleMove = (event: PointerEvent) => {
        const point = fractionFromEvent(event)
        const px = Math.min(Math.max(point.x, 0), 1)
        const py = Math.min(Math.max(point.y, 0), 1)
        const signX = px >= anchorX ? 1 : -1
        const signY = py >= anchorY ? 1 : -1

        let maxWidth = signX === 1 ? 1 - anchorX : anchorX
        let maxHeight = signY === 1 ? 1 - anchorY : anchorY
        if (fractionAspect) {
          // Keep both bounds honest with each other so the derived side
          // never pushes the box past the image edge.
          maxWidth = Math.min(maxWidth, maxHeight * fractionAspect)
          maxHeight = maxWidth / fractionAspect
        }

        const width = Math.min(Math.max(Math.abs(px - anchorX), MIN_SIZE), Math.max(maxWidth, MIN_SIZE))
        const height = fractionAspect
          ? width / fractionAspect
          : Math.min(Math.max(Math.abs(py - anchorY), MIN_SIZE), Math.max(maxHeight, MIN_SIZE))

        const x = signX === 1 ? anchorX : anchorX - width
        const y = signY === 1 ? anchorY : anchorY - height
        onChange(clampRect({ x, y, width, height }))
      }
      const handleUp = () => {
        window.removeEventListener('pointermove', handleMove)
        window.removeEventListener('pointerup', handleUp)
      }
      window.addEventListener('pointermove', handleMove)
      window.addEventListener('pointerup', handleUp)
    },
    [fractionAspect, fractionFromEvent, onChange, rect],
  )

  return (
    <div className="crop-stage" ref={stageRef}>
      <div
        className="crop-selection"
        style={{
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.width * 100}%`,
          height: `${rect.height * 100}%`,
        }}
        onPointerDown={startMove}
      >
        {CORNERS.map((corner) => (
          <span
            key={corner}
            className={`crop-handle crop-handle-${corner}`}
            onPointerDown={(event) => startResize(event, corner)}
          />
        ))}
      </div>
    </div>
  )
}
