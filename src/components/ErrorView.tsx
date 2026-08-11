interface ErrorViewProps {
  message: string
  onRetry: () => void
}

export function ErrorView({ message, onRetry }: ErrorViewProps) {
  return (
    <div className="error-view">
      <svg className="icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M12 8v5m0 3.2v.1"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      <h2>Something went wrong</h2>
      <p>{message}</p>
      <button type="button" className="btn btn-primary" onClick={onRetry}>
        Try again
      </button>
    </div>
  )
}
