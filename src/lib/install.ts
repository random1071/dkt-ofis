// Tarayıcının "uygulamayı yükle" olayını yakalar (Chrome / Edge / Android).
type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: BIPEvent | null = null;
const listeners = new Set<() => void>();

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as BIPEvent;
  listeners.forEach((l) => l());
});
window.addEventListener('appinstalled', () => {
  deferred = null;
  listeners.forEach((l) => l());
});

export function canInstall() {
  return !!deferred;
}

export function subscribeInstall(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export async function promptInstall() {
  if (!deferred) return;
  await deferred.prompt();
  await deferred.userChoice.catch(() => undefined);
  deferred = null;
  listeners.forEach((l) => l());
}

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
