import type { PushConfig } from '@cook-first/shared';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { pushSettingsCopy as copy } from '../copy';
import { platform } from '../platform';
import { useToastStore } from '../stores/toastStore';

export type PushState = 'loading' | 'ios' | 'unsupported' | 'not-configured' | 'blocked' | 'off' | 'on';

/**
 * Push reminders for this device: what it can do, and turning them on or off. Permission is only asked for
 * when `enable` is called, which must come from a tap (Settings, or the last step of the first-run guide).
 */
export function usePushReminders() {
  const toast = useToastStore((s) => s.show);
  const [state, setState] = useState<PushState>('loading');
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    const settle = (next: PushState) => current && setState(next);
    async function check() {
      const support = await platform.push.support();
      if (support === 'ios-needs-home-screen') return settle('ios');
      if (support === 'unsupported') return settle('unsupported');
      const serverConfig = await api.pushConfig();
      if (!current) return;
      setConfig(serverConfig);
      if (!platform.push.isAvailable(serverConfig)) return settle('not-configured');
      if (await platform.push.isBlocked()) return settle('blocked');
      settle((await platform.push.isOn()) ? 'on' : 'off');
    }
    check().catch(() => settle('not-configured'));
    return () => {
      current = false;
    };
  }, []);

  async function enable() {
    if (!config) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await platform.push.turnOn(config);
      if (result === 'on') {
        setState('on');
        toast(copy.onToast);
      } else if (result === 'blocked') setState('blocked');
      else setNote(copy.dismissed);
    } catch {
      setNote(copy.failed);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await platform.push.turnOff();
      setState('off');
      toast(copy.offToast);
    } catch {
      toast(copy.saveFailed);
    } finally {
      setBusy(false);
    }
  }

  /** Why reminders can't be turned on here, in words, or null when they can (or already are). */
  const message =
    state === 'ios'
      ? copy.iosHomeScreen
      : state === 'unsupported'
        ? copy.unsupported
        : state === 'not-configured'
          ? copy.notConfigured
          : state === 'blocked'
            ? copy.blocked
            : null;

  return { state, note, busy, enable, disable, message };
}
