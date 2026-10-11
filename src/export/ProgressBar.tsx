export function ProgressBar({ label, fraction }: { label: string; fraction: number }) {
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100)
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <span className="pc-caption pc-mono">{label}</span>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1 rounded-pill bg-inset">
        <div className="h-1 rounded-pill bg-accent" style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}
