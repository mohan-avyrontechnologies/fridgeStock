import { useState, type FormEvent } from 'react';
import { ApiError, api } from '../api/client';
import { dataCopy } from '../copy';
import { useAuthStore } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { Button, Field, FormError } from './ui';

/** Settings: download everything as a JSON file, or delete the account (password required). */
export function YourData() {
  const logout = useAuthStore((s) => s.logout);
  const toast = useToastStore((s) => s.show);
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);

  async function download() {
    setExporting(true);
    try {
      const data = await api.exportData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `cook-first-data-${data.exportedAt.slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast(dataCopy.exportDone);
    } catch {
      toast(dataCopy.exportError);
    } finally {
      setExporting(false);
    }
  }

  async function remove(e: FormEvent) {
    e.preventDefault();
    setPasswordError(undefined);
    setFormError(null);
    setBusy(true);
    try {
      await api.deleteAccount({ password });
      logout();
      toast(dataCopy.deleted);
    } catch (err) {
      if (err instanceof ApiError && err.field === 'password') setPasswordError(err.message);
      else setFormError(dataCopy.deleteError);
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="your-data" className="space-y-4">
      <div>
        <h2 id="your-data" className="mb-1 text-lg font-semibold">
          {dataCopy.title}
        </h2>
        <p className="mb-3 text-sm text-muted">{dataCopy.exportHint}</p>
        <Button variant="secondary" disabled={exporting} onClick={download}>
          {exporting ? dataCopy.exporting : dataCopy.exportButton}
        </Button>
      </div>

      <div className="rounded-2xl border border-line bg-card p-4">
        <p className="mb-3 text-sm text-muted">{dataCopy.deleteHint}</p>
        {!confirming ? (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {dataCopy.deleteOpen}
          </Button>
        ) : (
          <form onSubmit={remove} className="space-y-3" noValidate>
            <FormError message={formError} />
            <Field
              label={dataCopy.passwordLabel}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError(undefined);
              }}
              error={passwordError}
            />
            <div className="flex gap-2">
              <Button type="submit" variant="danger" disabled={busy || password === ''}>
                {busy ? dataCopy.deleting : dataCopy.deleteConfirm}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                  setPassword('');
                  setPasswordError(undefined);
                  setFormError(null);
                }}
              >
                {dataCopy.cancel}
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
