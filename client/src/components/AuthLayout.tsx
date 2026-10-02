import type { ReactNode } from 'react';
import { describeError } from '../lib/errors';
import { ApiError } from '../api/client';
import { estimateNote, screenCopy } from '../copy';
import { EstimateNote } from './Urgency';

export type AuthErrors = Partial<Record<'name' | 'email' | 'password' | 'form', string>>;

/** Maps an API error onto the sign-in/sign-up form fields. */
export function authErrorsFrom(err: unknown): AuthErrors {
  if (err instanceof ApiError) {
    if (err.field === 'name' || err.field === 'email' || err.field === 'password') return { [err.field]: err.message };
    // A wrong password or a taken email is the server's own explanation; a dropped connection or a server problem isn't.
    return { form: err.status === 0 || err.status >= 500 ? describeError(err, 'continue') : err.message };
  }
  return { form: describeError(err, 'continue') };
}

/** Frame for the sign-in and sign-up screens: a brand panel beside the form on desktop. */
export function AuthLayout({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-2">
      <aside className="hidden flex-col justify-between bg-brand p-12 text-on-brand lg:flex">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="" className="size-10 rounded-button ring-1 ring-white/20" />
          <span className="text-xl font-bold tracking-tight">Cook First</span>
        </div>
        <div className="max-w-md">
          <p className="text-4xl leading-tight font-bold tracking-tight">{screenCopy.auth.headline}</p>
          <ul className="mt-8 space-y-3 text-lg text-on-brand">
            {screenCopy.auth.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
        <p className="max-w-md text-sm text-on-brand">{estimateNote}</p>
      </aside>

      <main className="top-inset mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 lg:justify-center lg:py-12">
        <div className="pt-12 pb-8 lg:pt-0">
          <img src="/icon.svg" alt="" className="size-12 lg:hidden" />
          <p className="mt-5 text-sm font-semibold text-brand lg:mt-0">Cook First</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{title}</h1>
          <p className="mt-2 text-muted">{screenCopy.auth.intro}</p>
        </div>
        {children}
        <p className="mt-6 text-center text-sm text-muted">{footer}</p>
        <div className="mt-auto pt-10 lg:hidden">
          <EstimateNote />
        </div>
      </main>
    </div>
  );
}
