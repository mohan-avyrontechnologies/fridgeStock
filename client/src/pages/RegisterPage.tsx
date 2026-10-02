import { registerSchema } from '@cook-first/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { AuthLayout, authErrorsFrom, type AuthErrors } from '../components/AuthLayout';
import { Button, Field, FormError } from '../components/ui';
import { check } from '../lib/validation';
import { useAuthStore } from '../stores/authStore';

export function RegisterPage() {
  const register = useAuthStore((s) => s.register);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<AuthErrors>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const { errors: found } = check(registerSchema, { name, email, password });
    setErrors(found ?? {});
    if (found) return;

    setBusy(true);
    try {
      // The time zone is captured silently from the browser by the API client.
      await register(name, email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setErrors(authErrorsFrom(err));
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      footer={
        <>
          Already have an account?{' '}
          <Link
            to="/login"
            className="inline-flex min-h-12 items-center font-semibold text-brand underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={errors.form ?? null} />
        <Field
          label="Name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
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
