import { create } from 'zustand';

/** Équivalent minimal du MatSnackBar : un message à la fois, avec action optionnelle. */
export interface Toast {
  id: number;
  message: string;
  action?: string;
  onAction?: () => void;
}

export const useToast = create<{ toast: Toast | null }>()(() => ({ toast: null }));

let nextId = 1;
let timer: ReturnType<typeof setTimeout> | null = null;

export function showToast(
  message: string,
  options: { action?: string; onAction?: () => void; duration?: number } = {},
): void {
  const id = nextId++;
  if (timer) {
    clearTimeout(timer);
  }
  useToast.setState({ toast: { id, message, action: options.action, onAction: options.onAction } });
  timer = setTimeout(() => dismissToast(id), options.duration ?? 3000);
}

export function dismissToast(id?: number): void {
  const current = useToast.getState().toast;
  if (current && (id === undefined || current.id === id)) {
    useToast.setState({ toast: null });
  }
}
