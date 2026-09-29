import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover disabled:opacity-60',
  secondary: 'bg-card text-ink border border-line hover:bg-paper disabled:opacity-60',
  ghost: 'text-brand hover:bg-brand-soft disabled:opacity-60',
  danger: 'bg-card text-danger border border-line hover:bg-past/40 disabled:opacity-60',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition-colors ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function Field({
  label,
  error,
  hint,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  const generatedId = useId();
  const id = props.id ?? generatedId;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`block min-h-12 w-full rounded-xl border bg-card px-3.5 text-base text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none ${
          error ? 'border-danger' : 'border-line'
        }`}
        {...props}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Chip({
  selected,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`min-h-11 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors ${
        selected ? 'border-brand bg-brand text-white' : 'border-line bg-card text-ink hover:border-brand/50'
      }`}
      {...props}
    >
      {children}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-xl bg-past px-3.5 py-3 text-sm text-past-ink">
      {message}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-card px-5 py-10 text-center">
      <p className="text-base font-semibold text-ink">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex justify-center py-10">
      <span className="size-6 animate-spin rounded-full border-2 border-line border-t-brand" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 id={id} className="text-lg font-semibold text-ink">
        {children}
      </h2>
      {action}
    </div>
  );
}
