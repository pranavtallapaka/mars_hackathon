import { playVoice } from '../voicePlayer';

export type VoiceCueState =
  | { status: 'idle' }
  | { status: 'loading'; label: string }
  | { status: 'playing'; label: string }
  | { status: 'blocked'; label: string; url: string }
  | { status: 'unavailable'; label: string; reason?: string };

export function VoiceCue({ cue }: { cue: VoiceCueState }) {
  if (cue.status === 'idle') return null;
  return (
    <p className={`voice-cue voice-${cue.status}`}>
      <span className="voice-dot" aria-hidden />
      {cue.status === 'loading' && <span>{cue.label} · requesting voice</span>}
      {cue.status === 'playing' && <span>{cue.label} · playing</span>}
      {cue.status === 'blocked' && (
        <>
          <span>{cue.label} · autoplay blocked</span>
          <button type="button" onClick={() => void playVoice(cue.url)}>
            Play
          </button>
        </>
      )}
      {cue.status === 'unavailable' && <span>{cue.label} · {cue.reason ?? 'unavailable'}. Typed path still works.</span>}
    </p>
  );
}
