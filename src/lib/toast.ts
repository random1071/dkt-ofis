export type ToastKind = 'success' | 'error' | 'info' | 'warning';
export interface ToastMsg {
  id: number;
  kind: ToastKind;
  text: string;
  action?: { label: string; run: () => void };
  ttl: number;
}

type Listener = (t: ToastMsg[]) => void;
let items: ToastMsg[] = [];
const listeners = new Set<Listener>();
let seq = 1;

function emit() {
  listeners.forEach((l) => l(items));
}

export function toast(text: string, kind: ToastKind = 'success', opts: { action?: ToastMsg['action']; ttl?: number } = {}) {
  const t: ToastMsg = { id: seq++, kind, text, action: opts.action, ttl: opts.ttl ?? (kind === 'error' ? 7000 : 3200) };
  items = [...items.slice(-3), t];
  emit();
  setTimeout(() => dismissToast(t.id), t.ttl);
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(l: Listener) {
  listeners.add(l);
  l(items);
  return () => listeners.delete(l);
}
