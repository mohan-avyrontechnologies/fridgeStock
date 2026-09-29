import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '../api/client';
import { EstimateNote } from '../components/Urgency';
import { Button, Field, FormError } from '../components/ui';
import { estimateNote, screenCopy } from '../copy';
import { useAuthStore } from '../stores/authStore';

type Errors = Partial<Record<'name' | 'email' | 'password' | 'form', string>>;

function AuthLayout({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-2">
      {/* Desktop only: a calm brand panel beside the form. */}
      <aside className="hidden flex-col justify-between bg-brand p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="" className="size-10 rounded-xl ring-1 ring-white/20" />
          <span className="text-xl font-bold tracking-tight">Cook First</span>
        </div>
        <div className="max-w-md">
          <p className="text-4xl leading-tight font-bold tracking-tight">{screenCopy.auth.headline}</p>
          <ul className="mt-8 space-y-3 text-lg text-white/85">
            {screenCopy.auth.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>
        <p className="max-w-md text-sm text-white/70">{estimateNote}</p>
      </aside>

      <main className="top-inset mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 lg:justify-center lg:py-12">
        <div className="pt-12 pb-8 lg:pt-0">
          <img src="/icon.svg" alt="" className="size-12 lg:hidden" />
          <p className="mt-5 text-sm font-semibold tracking-wide text-brand uppercase lg:mt-0">Cook First</p>
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

function errorsFrom(err: unknown): Errors {
  if (err instanceof ApiError) {
    if (err.field === 'name' || err.field === 'email' || err.field === 'password') return { [err.field]: err.message };
    return { form: err.message };
  }
  return { form: 'Something went wrong. Try again.' };
}

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (!email.trim()) next.email = 'Enter your email.';
    if (!password) next.password = 'Enter your password.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setErrors(errorsFrom(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      footer={
        <>
          New here?{' '}
          <Link to="/register" className="font-semibold text-brand underline-offset-2 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={errors.form ?? null} />
        <Field label="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <Field label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const register = useAuthStore((s) => s.register);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {};
    if (!name.trim()) next.name = 'Enter your name.';
    if (!email.trim()) next.email = 'Enter your email.';
    if (password.length < 8) next.password = 'Password must be at least 8 characters.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setBusy(true);
    try {
      await register(name, email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setErrors(errorsFrom(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand underline-offset-2 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={errors.form ?? null} />
        <Field label="Name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
        <Field label="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint="At least 8 characters."
        />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  );
}
