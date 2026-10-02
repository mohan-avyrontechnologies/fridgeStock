import { Check } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type ElementType,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import { useToastStore } from '../stores/toastStore';
import { errorCopy, emptyCopy } from '../copy';

/**
 * The shared building blocks: Button, Card, Chip, Field, BottomSheet, Toast and Skeleton, plus the smaller
 * pieces every screen uses. Corners follow the design tokens (cards 16 px, buttons 12 px, chips fully round)
 * and every control is at least 48 px tall.
 */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-hover disabled:opacity-60',
  secondary: 'bg-card text-ink border border-field hover:bg-paper disabled:opacity-60',
  ghost: 'text-brand hover:bg-brand-soft disabled:opacity-60',
  danger: 'bg-card text-danger border border-field hover:bg-past disabled:opacity-60',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-button px-4 text-base font-semibold transition-colors ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

/** A surface for a group of content: white (or dark green), 16 px corners and a hairline. */
export function Card({
  as: Tag = 'div',
  className = '',
  ...props
}: { as?: ElementType; className?: string; children?: ReactNode } & Record<string, unknown>) {
  return <Tag className={`rounded-card border border-line bg-card ${className}`} {...props} />;
}

export function Field({
  label,
  error,
  hint,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
  ref?: Ref<HTMLInputElement>;
}) {
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
        className={`block min-h-12 w-full rounded-button border bg-card px-3.5 text-base text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none ${
          error ? 'border-danger' : 'border-field'
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

/** A filter or choice: fully rounded, 48 px tall. */
export function Chip({
  selected,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`inline-flex min-h-12 shrink-0 items-center justify-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors ${
        selected ? 'border-brand bg-brand text-on-brand' : 'border-field bg-card text-ink hover:border-brand'
      } ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-button bg-past px-3.5 py-3 text-sm text-past-ink">
      {message}
    </div>
  );
}

/** What to show when there is nothing yet: a short explanation and, where there is one, the next step. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-field bg-card px-5 py-10 text-center">
      <p className="font-display text-lg font-semibold text-ink">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** What to show when something could not be loaded: what happened, how to fix it, and a Try again button. */
export function LoadError({
  title,
  detail,
  onRetry,
}: {
  title: string;
  /** What to do about it. Defaults to checking the connection. */
  detail?: string;
  onRetry: () => void;
}) {
  return (
    <EmptyState
      title={title}
      action={
        <Button variant="secondary" onClick={onRetry}>
          {errorCopy.retry}
        </Button>
      }
    >
      {detail ?? emptyCopy.loadHint}
    </EmptyState>
  );
}

/** A grey placeholder shape shown while something loads (it pulses, unless the person prefers less motion). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton rounded-card bg-line ${className}`} />;
}

/** A few placeholder cards, announced once to a screen reader as "Loading". */
export function SkeletonList({
  count = 3,
  label = 'Loading',
  className = 'h-24',
}: {
  count?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div role="status" className="space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={className} />
      ))}
    </div>
  );
}

export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 id={id} className="text-xl font-semibold text-ink">
        {children}
      </h2>
      {action}
    </div>
  );
}

/**
 * A checkbox with a 48 px tap area: the real input covers the whole area (so
 * keyboard, screen readers and labels work as normal) and a drawn box sits on top.
 */
export function Checkbox({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <span className={`relative inline-grid size-12 shrink-0 place-items-center ${className}`}>
      <input type="checkbox" className="peer absolute inset-0 size-full cursor-pointer opacity-0" {...props} />
      <span
        aria-hidden
        className="pointer-events-none grid size-6 place-items-center rounded-md border-2 border-field bg-card text-transparent transition-colors peer-checked:border-brand peer-checked:bg-brand peer-checked:text-on-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand"
      >
        <Check className="size-4" strokeWidth={3} />
      </span>
    </span>
  );
}

/** An on/off switch with a label (and an optional hint), at least 48 px tall. */
export function Switch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4">
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="peer sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className="relative h-7 w-12 shrink-0 rounded-full bg-field transition-colors peer-checked:bg-brand peer-focus-visible:outline-2 peer-focus-visible:outline-brand after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5"
      />
    </label>
  );
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A panel that slides up from the bottom of a phone (and centres on a larger screen). It is a real dialog:
 * focus moves in when it opens (to the first field, or to whatever has `data-autofocus`), Tab stays inside,
 * Escape and the backdrop close it, and focus returns to where it was. Change `focusKey` to move focus in
 * again, for a sheet with more than one step.
 */
export function BottomSheet({
  title,
  description,
  onClose,
  children,
  focusKey,
  className = '',
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  focusKey?: string | number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, []);

  // Move focus in when the sheet opens, and again when its step changes.
  useEffect(() => {
    const target = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea');
    (target ?? ref.current)?.focus();
  }, [focusKey]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button aria-label="Close" className="absolute inset-0 bg-ink/40" onClick={onClose} tabIndex={-1} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`sheet-in bottom-inset relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-card px-4 pt-3 pb-4 shadow-xl focus:outline-none sm:rounded-3xl ${className}`}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-10 rounded-full bg-line sm:hidden" />
        <h2 id={titleId} className="px-1 text-xl font-semibold">
          {title}
        </h2>
        {description && <p className="px-1 text-sm text-muted">{description}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

/** Short confirmation messages, with an optional action such as "Undo". */
export function Toast() {
  const { message, action, clear } = useToastStore();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex justify-center px-4 lg:bottom-8 lg:left-64"
    >
      {message && (
        <div className="sheet-in pointer-events-auto flex items-center gap-2 rounded-full bg-ink py-1.5 pr-1.5 pl-5 text-sm font-medium text-paper shadow-lg">
          <span className="py-1">{message}</span>
          {action && (
            <button
              type="button"
              onClick={() => {
                clear();
                action.onClick();
              }}
              className="min-h-12 rounded-full px-4 font-semibold text-paper underline hover:bg-paper/10"
            >
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
