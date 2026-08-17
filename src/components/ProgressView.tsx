interface ProgressViewProps {
  label: string
  percent: number | null
  /** Headline above the bar; defaults to the plain background-removal wording. */
  title?: string
}

export function ProgressView({ label, percent, title }: ProgressViewProps) {
  return (
    <div className="progress-view" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <h2>{title ?? 'Removing background…'}</h2>
      <p>{label}</p>
      <div
        className="progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
      >
        <div
          className="progress-bar-fill"
          style={{ width: `${Math.max(6, percent ?? 8)}%` }}
        />
      </div>
    </div>
  )
}
