import { create } from 'zustand';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastState {
  message: string | null;
  action: ToastAction | null;
  /** A short message; with an action (such as "Undo") it stays up a little longer. */
  show: (message: string, action?: ToastAction) => void;
  clear: () => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useToastStore = create<ToastState>()((set) => ({
  message: null,
  action: null,
  show(message, action) {
    clearTimeout(timer);
    set({ message, action: action ?? null });
    timer = setTimeout(() => set({ message: null, action: null }), action ? 7000 : 3000);
  },
  clear() {
    clearTimeout(timer);
    set({ message: null, action: null });
  },
}));
