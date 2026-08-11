interface ProgressViewProps {
  label: string
  percent: number | null
}

export function ProgressView({ label, percent }: ProgressViewProps) {
  return (
    <div className="progress-view" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <h2>Removing background&hellip;</h2>
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
