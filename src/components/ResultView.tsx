interface ResultViewProps {
  originalUrl: string
  resultUrl: string
  downloadName: string
  onReset: () => void
}

export function ResultView({ originalUrl, resultUrl, downloadName, onReset }: ResultViewProps) {
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
            <img src={resultUrl} alt="Cutout with transparent background" />
          </div>
        </div>
      </div>

      <div className="result-actions">
        <a className="btn btn-primary" href={resultUrl} download={downloadName}>
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
