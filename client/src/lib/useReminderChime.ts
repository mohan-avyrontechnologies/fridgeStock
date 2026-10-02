import { PUSH_KINDS, type PushKind } from '@cook-first/shared';
import { useEffect } from 'react';
import { PUSH_RECEIVED_EVENT } from '../platform/events';
import { useAuthStore } from '../stores/authStore';
import { playChime, trackInteraction } from './chime';

/** What the service worker posts to an open page when a push arrives (client/public/sw.js). */
export const REMINDER_MESSAGE = 'cook-first:reminder';

const isKind = (value: unknown): value is PushKind => (PUSH_KINDS as readonly unknown[]).includes(value);

/**
 * Plays the matching chime when a reminder arrives while the app is open: from the service worker in a
 * browser, or from the push plugin in the apps. See lib/chime.ts for when it is allowed to play.
 */
export function useReminderChime(): void {
  useEffect(() => {
    trackInteraction();
    const play = (kind: unknown) => {
      if (isKind(kind)) void playChime(useAuthStore.getState().user, kind);
    };
    const onPush = (event: Event) => play((event as CustomEvent).detail?.kind);
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === REMINDER_MESSAGE) play(event.data.kind);
    };
    window.addEventListener(PUSH_RECEIVED_EVENT, onPush);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener(PUSH_RECEIVED_EVENT, onPush);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, []);
}
