import { useCallback, useEffect, useRef, useState } from 'react'
import './index.css'
import { DropZone } from './components/DropZone'
import { ProgressView } from './components/ProgressView'
import { ErrorView } from './components/ErrorView'
import { ResultView } from './components/ResultView'
import { removeImageBackground, validateImageFile, type RemovalProgress } from './lib/backgroundRemoval'

type Stage = 'idle' | 'processing' | 'done' | 'error'

function progressLabel(progress: RemovalProgress | null): string {
  if (!progress) return 'Warming up the model in your browser…'
  if (progress.key.startsWith('fetch')) {
    return 'Downloading the AI model (first time only)…'
  }
  return 'Analyzing your image…'
}

function downloadNameFor(file: File): string {
  const base = file.name.replace(/\.[^/.]+$/, '') || 'image'
  return `${base}-no-bg.png`
}

function App() {
  const [stage, setStage] = useState<Stage>('idle')
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const [resultUrl, setResultUrl] = useState<string | null>(null)
  const [downloadName, setDownloadName] = useState('image-no-bg.png')
  const [errorMessage, setErrorMessage] = useState('')
  const [progress, setProgress] = useState<RemovalProgress | null>(null)
  const objectUrlsRef = useRef<string[]>([])

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  const trackUrl = useCallback((url: string) => {
    objectUrlsRef.current.push(url)
    return url
  }, [])

  const reset = useCallback(() => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    objectUrlsRef.current = []
    setOriginalUrl(null)
    setResultUrl(null)
    setProgress(null)
    setErrorMessage('')
    setStage('idle')
  }, [])

  const handleFile = useCallback(
    async (file: File) => {
      const validationError = validateImageFile(file)
      if (validationError) {
        setErrorMessage(validationError)
        setStage('error')
        return
      }

      const localOriginalUrl = trackUrl(URL.createObjectURL(file))
      setOriginalUrl(localOriginalUrl)
      setDownloadName(downloadNameFor(file))
      setProgress(null)
      setStage('processing')

      try {
        const blob = await removeImageBackground(file, setProgress)
        setResultUrl(trackUrl(URL.createObjectURL(blob)))
        setStage('done')
      } catch (err) {
        console.error('Background removal failed', err)
        setErrorMessage(
          'We could not process this image in your browser. Try a smaller image, or a different browser with WebAssembly support.',
        )
        setStage('error')
      }
    },
    [trackUrl],
  )

  return (
    <>
      <header className="site-header">
        <img className="logo" src="/favicon.svg" alt="" />
        <span className="brand">BGRemove</span>
      </header>

      <main className="page">
        <section className="hero">
          <h1>
            Free <span className="accent">Background Remover</span> &mdash; Right in Your
            Browser
          </h1>
          <p className="lede">
            Remove the background from any photo in seconds. No sign-up, no watermark, no
            upload &mdash; the image never leaves your device.
          </p>
          <div className="badges">
            <span className="badge">100% Free</span>
            <span className="badge">No Sign-up</span>
            <span className="badge">Runs In-Browser</span>
            <span className="badge">Private by Design</span>
          </div>
        </section>

        <div className="tool-card">
          {stage === 'idle' && <DropZone onFile={handleFile} />}
          {stage === 'processing' && (
            <ProgressView
              label={progressLabel(progress)}
              percent={
                progress && progress.total > 0
                  ? Math.round((progress.current / progress.total) * 100)
                  : null
              }
            />
          )}
          {stage === 'error' && <ErrorView message={errorMessage} onRetry={reset} />}
          {stage === 'done' && originalUrl && resultUrl && (
            <ResultView
              originalUrl={originalUrl}
              resultUrl={resultUrl}
              downloadName={downloadName}
              onReset={reset}
            />
          )}
        </div>

        <section className="content">
          <div>
            <h2>How the Free Background Remover Works</h2>
            <div className="grid-3">
              <div className="step">
                <span className="num">1</span>
                <h3>Upload a photo</h3>
                <p>Drag and drop a PNG, JPG, or WebP file, or pick one from your device.</p>
              </div>
              <div className="step">
                <span className="num">2</span>
                <h3>AI removes the background</h3>
                <p>
                  An on-device AI model finds the subject and cuts out the background &mdash;
                  no server, no queue.
                </p>
              </div>
              <div className="step">
                <span className="num">3</span>
                <h3>Download your cutout</h3>
                <p>Save a transparent PNG, ready for product photos, portraits, or designs.</p>
              </div>
            </div>
          </div>

          <div>
            <h2>Why Use an In-Browser Background Remover?</h2>
            <p>
              Most "free" background removal tools upload your photo to a server, charge for
              high-resolution downloads, or stamp a watermark on the result. This tool is
              different: it downloads a small AI model to your browser once, then removes
              backgrounds locally using WebAssembly. Your images are never sent anywhere,
              which makes it a genuinely private way to remove image backgrounds for e-commerce
              listings, ID photos, headshots, and social media graphics.
            </p>
          </div>

          <div>
            <h2>Frequently Asked Questions</h2>
            <div className="faq-item">
              <h3>Is this background remover really free?</h3>
              <p>
                Yes. There's no account, no credit card, and no per-image fee. It's free
                because the AI model runs on your own device instead of a paid cloud API.
              </p>
            </div>
            <div className="faq-item">
              <h3>Do you upload or store my images?</h3>
              <p>
                No. Processing happens entirely in your browser using WebAssembly. Your photo
                never leaves your device, and nothing is uploaded to a server.
              </p>
            </div>
            <div className="faq-item">
              <h3>Why does the first image take longer?</h3>
              <p>
                The first time you use the tool, your browser downloads the AI model (a few
                seconds to about ten, depending on your connection). It's then cached, so
                future removals are much faster.
              </p>
            </div>
            <div className="faq-item">
              <h3>What image formats are supported?</h3>
              <p>
                You can upload PNG, JPG, or WebP images up to 25&nbsp;MB. The result always
                downloads as a PNG with a transparent background.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <p>Free background remover &middot; processed on-device &middot; no images stored.</p>
      </footer>
    </>
  )
}

export default App
