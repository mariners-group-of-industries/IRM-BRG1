import { cn } from '@irm/ui';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden>
      <rect width="32" height="32" rx="7" fill="var(--color-accent)" />
      <rect x="8" y="16" width="4" height="8" rx="1" fill="#fff" opacity=".6" />
      <rect x="14" y="12" width="4" height="12" rx="1" fill="#fff" opacity=".8" />
      <rect x="20" y="8" width="4" height="16" rx="1" fill="#fff" />
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <BrandMark />
      <div className="leading-tight">
        <p className="text-sm font-semibold tracking-tight text-ink">IRM Platform</p>
        <p className="text-2xs text-ink-3">AGM / EGM</p>
      </div>
    </div>
  );
}
