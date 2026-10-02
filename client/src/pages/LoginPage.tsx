import { loginSchema } from '@cook-first/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { AuthLayout, authErrorsFrom, type AuthErrors } from '../components/AuthLayout';
import { Button, Field, FormError } from '../components/ui';
import { check } from '../lib/validation';
import { useAuthStore } from '../stores/authStore';

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<AuthErrors>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { errors: found } = check(loginSchema, { email, password });
    setErrors(found ?? {});
    if (found) return;

    setBusy(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setErrors(authErrorsFrom(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      footer={
        <>
          New here?{' '}
          <Link
            to="/register"
            className="inline-flex min-h-12 items-center font-semibold text-brand underline-offset-2 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={errors.form ?? null} />
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  );
}
