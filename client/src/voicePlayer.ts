/** One shared element so a compile click unlocks later rover playback after the delay. */
const el = typeof Audio === 'undefined' ? null : new Audio();

export function unlockVoice(): void {
  if (!el) return;
  el.muted = true;
  void el.play().then(
    () => {
      el.pause();
      el.muted = false;
    },
    () => {
      el.muted = false;
    },
  );
}

export function stopVoice(): void {
  if (!el) return;
  el.pause();
  el.removeAttribute('src');
  el.load();
}

export function playVoice(url: string): Promise<void> {
  if (!el) return Promise.reject(new Error('no audio'));
  el.muted = false;
  el.src = url;
  return el.play().then(() => undefined);
}
