import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ProgressView } from './ProgressView'
import { removeImageBackground, type RemovalProgress } from '../lib/backgroundRemoval'
import { regionAt } from '../lib/mask'
import {
  buildObjectPreview,
  composeKeptCutout,
  createOverlayCanvas,
  releaseObjectPreview,
  type ObjectPreview,
} from '../lib/objectSelection'

/** Tallest the preview canvas may get, so the toolbar stays above the fold. */
const MAX_PREVIEW_HEIGHT = 420
/** Retina is worth it for the outlines; beyond 2x it is just memory. */
const MAX_PIXEL_RATIO = 2

type Phase = 'analyzing' | 'ready' | 'composing'

interface SelectObjectsViewProps {
  file: File
  /** Object URL of the upload, shown if object detection is unavailable. */
  imageUrl: string
  onConfirm: (blob: Blob) => void
  onCancel: () => void
  /** Background removal itself failed — nothing usable to show. */
  onFailure: (message: string) => void
}

function progressLabel(progress: RemovalProgress | null): string {
  if (!progress) return 'Warming up the model in your browser…'
  if (progress.key.startsWith('fetch')) {
    return 'Downloading the AI model (first time only)…'
  }
  return 'Analyzing your image…'
}

export function SelectObjectsView({
  file,
  imageUrl,
  onConfirm,
  onCancel,
  onFailure,
}: SelectObjectsViewProps) {
  const [phase, setPhase] = useState<Phase>('analyzing')
  const [progress, setProgress] = useState<RemovalProgress | null>(null)
  const [preview, setPreview] = useState<ObjectPreview | null>(null)
  /** Set when removal worked but the objects could not be detected. */
  const [fallbackCutout, setFallbackCutout] = useState<Blob | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set<number>())
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [stageWidth, setStageWidth] = useState(0)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<ObjectPreview | null>(null)

  useEffect(() => {
    previewRef.current = preview
  }, [preview])

  // Bitmaps hold decoded full-resolution pixels; always hand them back.
  useEffect(() => {
    return () => {
      if (previewRef.current) {
        releaseObjectPreview(previewRef.current)
        previewRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      let cutout: Blob
      try {
        cutout = await removeImageBackground(file, (value) => {
          if (!cancelled) setProgress(value)
        })
      } catch (err) {
        console.error('Background removal failed', err)
        if (!cancelled) {
          onFailure(
            'We could not process this image in your browser. Try a smaller image, or a different browser with WebAssembly support.',
          )
        }
        return
      }
      if (cancelled) return

      try {
        const result = await buildObjectPreview(file, cutout)
        if (cancelled) {
          releaseObjectPreview(result)
          return
        }
        setPreview(result)
        // Default to the primary subject (the largest region) so the tool still
        // behaves like a one-click remover for single-subject photos.
        const primary = result.objects.regions[0]
        setSelected(new Set<number>(primary ? [primary.id] : []))
      } catch (err) {
        // Detection is an enhancement; the plain cutout is still good.
        console.error('Object detection failed', err)
        if (cancelled) return
        setFallbackCutout(cutout)
      }
      if (!cancelled) setPhase('ready')
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [file, onFailure])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const update = () => setStageWidth(stage.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [preview])

  const overlay = useMemo(
    () =>
      preview && preview.objects.regions.length > 0
        ? createOverlayCanvas(preview.objects, selected)
        : null,
    [preview, selected],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !preview || stageWidth <= 0) return
    const { sourceBitmap, objects } = preview
    if (sourceBitmap.width === 0 || sourceBitmap.height === 0) return

    const aspect = sourceBitmap.width / sourceBitmap.height
    let displayWidth = stageWidth
    let displayHeight = displayWidth / aspect
    if (displayHeight > MAX_PREVIEW_HEIGHT) {
      displayHeight = MAX_PREVIEW_HEIGHT
      displayWidth = displayHeight * aspect
    }

    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
    canvas.width = Math.round(displayWidth * ratio)
    canvas.height = Math.round(displayHeight * ratio)
    canvas.style.width = `${displayWidth}px`
    canvas.style.height = `${displayHeight}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, displayWidth, displayHeight)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(sourceBitmap, 0, 0, displayWidth, displayHeight)
    if (overlay) ctx.drawImage(overlay, 0, 0, displayWidth, displayHeight)

    const scaleX = displayWidth / objects.width
    const scaleY = displayHeight / objects.height
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '600 13px Inter, system-ui, sans-serif'
    for (const region of objects.regions) {
      const isSelected = selected.has(region.id)
      const x = region.centerX * scaleX
      const y = region.centerY * scaleY
      ctx.beginPath()
      ctx.arc(x, y, 13, 0, Math.PI * 2)
      ctx.fillStyle = isSelected ? '#7c3aed' : 'rgba(255, 255, 255, 0.92)'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(28, 26, 39, 0.35)'
      ctx.stroke()
      ctx.fillStyle = isSelected ? '#ffffff' : '#1c1a27'
      ctx.fillText(String(region.id), x, y)
    }
  }, [overlay, preview, selected, stageWidth])

  const toggleRegion = useCallback((id: number) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!preview) return
      const bounds = event.currentTarget.getBoundingClientRect()
      if (bounds.width === 0 || bounds.height === 0) return
      const { objects } = preview
      const x = ((event.clientX - bounds.left) / bounds.width) * objects.width
      const y = ((event.clientY - bounds.top) / bounds.height) * objects.height
      const id = regionAt(objects, x, y)
      if (id !== 0) toggleRegion(id)
    },
    [preview, toggleRegion],
  )

  const handleConfirm = useCallback(async () => {
    if (!preview || selected.size === 0) return
    setErrorMessage(null)
    setPhase('composing')
    try {
      onConfirm(await composeKeptCutout(preview, selected))
    } catch (err) {
      console.error('Building the cutout failed', err)
      setErrorMessage('We could not build the cutout. Please try again.')
      setPhase('ready')
    }
  }, [onConfirm, preview, selected])

  const handleKeepEverything = useCallback(() => {
    const cutout = fallbackCutout ?? preview?.cutout
    if (cutout) onConfirm(cutout)
  }, [fallbackCutout, onConfirm, preview])

  if (phase === 'analyzing') {
    return (
      <ProgressView
        title="Finding objects…"
        label={progressLabel(progress)}
        percent={
          progress && progress.total > 0
            ? Math.round((progress.current / progress.total) * 100)
            : null
        }
      />
    )
  }

  if (phase === 'composing') {
    return (
      <ProgressView
        title="Removing background…"
        label="Keeping the objects you selected…"
        percent={null}
      />
    )
  }

  const regions = preview?.objects.regions ?? []
  const detectionFailed = !preview || regions.length === 0

  return (
    <div className="select-view">
      <div className="select-intro">
        <h2>Choose what to keep</h2>
        <p>
          {detectionFailed
            ? 'We could not pick out separate objects in this photo, but the automatic cutout is ready.'
            : 'Click an object to keep it. Anything you leave out is removed along with the background.'}
        </p>
      </div>

      <div className="select-stage" ref={stageRef}>
        {preview ? (
          <canvas
            ref={canvasRef}
            className="select-canvas"
            onPointerDown={handleCanvasPointerDown}
          />
        ) : (
          <img src={imageUrl} alt="Your upload" />
        )}
      </div>

      {!detectionFailed && (
        <>
          <div className="select-toolbar">
            <div className="object-chips" role="group" aria-label="Objects to keep">
              {regions.map((region) => {
                const isSelected = selected.has(region.id)
                return (
                  <button
                    key={region.id}
                    type="button"
                    className={`chip${isSelected ? ' chip-active' : ''}`}
                    aria-pressed={isSelected}
                    onClick={() => toggleRegion(region.id)}
                  >
                    Object {region.id}
                  </button>
                )
              })}
            </div>
            <div className="select-bulk">
              <button
                type="button"
                className="chip"
                onClick={() => setSelected(new Set(regions.map((region) => region.id)))}
              >
                Select all
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => setSelected(new Set<number>())}
              >
                Clear all
              </button>
            </div>
          </div>
          <p className="select-count">
            Keeping {selected.size} of {regions.length}{' '}
            {regions.length === 1 ? 'object' : 'objects'}
          </p>
        </>
      )}

      {errorMessage && <p className="crop-error">{errorMessage}</p>}

      <div className="result-actions">
        {!detectionFailed && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleConfirm}
            disabled={selected.size === 0}
            title={
              selected.size === 0
                ? 'Select at least one object to keep'
                : 'Remove the background and everything you did not select'
            }
          >
            Remove background
          </button>
        )}
        <button
          type="button"
          className={`btn ${detectionFailed ? 'btn-primary' : 'btn-secondary'}`}
          onClick={handleKeepEverything}
          title="Skip the selection and use the automatic cutout"
        >
          Keep everything
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          Start over
        </button>
      </div>

      <p className="privacy-note">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="m9 12 2 2 4-4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Objects were detected on your device &mdash; nothing was uploaded.
      </p>
    </div>
  )
}
