import { useCallback, useEffect, useRef, useState } from 'react'
import { CropSelector } from './CropSelector'
import { cropImageToPng, FULL_RECT, type CropRect } from '../lib/cropImage'

interface ResultViewProps {
  originalUrl: string
  resultUrl: string
  downloadName: string
  onReset: () => void
}

const ASPECT_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Free', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
]

function isFullRect(rect: CropRect): boolean {
  return (
    Math.abs(rect.x) < 0.001 &&
    Math.abs(rect.y) < 0.001 &&
    Math.abs(rect.width - 1) < 0.001 &&
    Math.abs(rect.height - 1) < 0.001
  )
}

export function ResultView({ originalUrl, resultUrl, downloadName, onReset }: ResultViewProps) {
  // `activeUrl` is whatever is currently shown/downloadable: the full cutout
  // until the user applies a crop, then the cropped PNG. Cropping again
  // starts from this active result, so crops compose on the current image.
  const [activeUrl, setActiveUrl] = useState(resultUrl)
  const [selection, setSelection] = useState<CropRect>(FULL_RECT)
  const [aspect, setAspect] = useState<number | null>(null)
  const [isCropped, setIsCropped] = useState(false)
  const [cropError, setCropError] = useState<string | null>(null)
  // The cutout's natural pixel aspect ratio (width / height), used to convert
  // aspect presets into the fraction-of-image space the selection is tracked
  // in. Updated whenever the displayed image (re)loads.
  const [imageAspect, setImageAspect] = useState(1)
  const imgRef = useRef<HTMLImageElement>(null)
  const createdUrlsRef = useRef<string[]>([])

  // A new source result (fresh upload) clears any in-progress crop state and
  // frees object URLs we created for previous crops.
  useEffect(() => {
    createdUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    createdUrlsRef.current = []
    setActiveUrl(resultUrl)
    setSelection(FULL_RECT)
    setAspect(null)
    setIsCropped(false)
    setCropError(null)
  }, [resultUrl])

  useEffect(() => {
    return () => {
      createdUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  const handleAspectChange = useCallback((value: number | null) => {
    setAspect(value)
    if (value === null) return
    // The selection is tracked as a fraction of the displayed image, which
    // is rarely square, so a pixel aspect ratio (e.g. 1:1) has to be
    // rescaled by the image's own aspect ratio before it applies here.
    const fractionAspect = value / imageAspect
    setSelection((current) => {
      const centerX = current.x + current.width / 2
      const centerY = current.y + current.height / 2
      let width = current.width
      let height = width / fractionAspect
      if (height > 1) {
        height = 1
        width = height * fractionAspect
      }
      const x = Math.min(Math.max(centerX - width / 2, 0), 1 - width)
      const y = Math.min(Math.max(centerY - height / 2, 0), 1 - height)
      return { x, y, width, height }
    })
  }, [imageAspect])

  const selectionTooSmall = selection.width < 0.01 || selection.height < 0.01

  const handleCrop = useCallback(async () => {
    const img = imgRef.current
    if (!img || selectionTooSmall) return
    setCropError(null)
    try {
      const blob = await cropImageToPng(img, selection)
      const url = URL.createObjectURL(blob)
      createdUrlsRef.current.push(url)
      setActiveUrl(url)
      setSelection(FULL_RECT)
      setAspect(null)
      setIsCropped(true)
    } catch (err) {
      console.error('Crop failed', err)
      setCropError('Could not crop this image. Please try again.')
    }
  }, [selection, selectionTooSmall])

  const handleClearCrop = useCallback(() => {
    setSelection(FULL_RECT)
    setAspect(null)
    setIsCropped(false)
    setActiveUrl(resultUrl)
    setCropError(null)
  }, [resultUrl])

  const nothingToClear = isFullRect(selection) && !isCropped

  return (
    <div className="result-view">
      <div className="compare-grid">
        <div className="image-panel">
          <div className="panel-label">Original</div>
          <div className="panel-body">
            <img src={originalUrl} alt="Original upload" />
          </div>
        </div>
        <div className="image-panel">
          <div className="panel-label">Background removed</div>
          <div className="panel-body checkerboard">
            <div className="crop-frame">
              <img
                ref={imgRef}
                src={activeUrl}
                alt="Cutout with transparent background"
                onLoad={(event) => {
                  const el = event.currentTarget
                  if (el.naturalWidth > 0 && el.naturalHeight > 0) {
                    setImageAspect(el.naturalWidth / el.naturalHeight)
                  }
                }}
              />
              <CropSelector rect={selection} aspect={aspect} imageAspect={imageAspect} onChange={setSelection} />
            </div>
          </div>
        </div>
      </div>

      <div className="crop-toolbar">
        <div className="aspect-group" role="group" aria-label="Aspect ratio lock">
          {ASPECT_OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              className={`chip${aspect === option.value ? ' chip-active' : ''}`}
              onClick={() => handleAspectChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="crop-buttons">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleClearCrop}
            disabled={nothingToClear}
            title="Reset the crop selection to the full image"
          >
            Clear crop
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleCrop}
            disabled={selectionTooSmall}
            title={selectionTooSmall ? 'Selection is too small to crop' : 'Apply the crop selection'}
          >
            Crop
          </button>
        </div>
      </div>
      {cropError && <p className="crop-error">{cropError}</p>}

      <div className="result-actions">
        <a className="btn btn-primary" href={activeUrl} download={downloadName}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 4v11m0 0 4-4m-4 4-4-4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Download PNG
        </a>
        <button type="button" className="btn btn-secondary" onClick={onReset}>
          Remove another
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
        Processed entirely on your device &mdash; nothing was uploaded.
      </p>
    </div>
  )
}
