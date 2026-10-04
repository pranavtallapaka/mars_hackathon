import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { SpeakResult, TranscribeResult, VoiceRole } from '../shared/voice';
import { voiceKey } from '../shared/voice';

const TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
const STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
const TIMEOUT_MS = 45_000;
const MAX_AUDIO_BYTES = 2_000_000;

export const VOICE_DIR = path.join(process.cwd(), 'data/voice');

export const TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL ?? 'eleven_flash_v2_5';
export const STT_MODEL = process.env.ELEVENLABS_STT_MODEL ?? 'scribe_v2';

const VOICES: Record<VoiceRole, string> = {
  ground: process.env.ELEVENLABS_GROUND_VOICE ?? '21m00Tcm4TlvDq8ikWAM',
  rover: process.env.ELEVENLABS_ROVER_VOICE ?? 'pNInz6obpgDQGcFmaJgB',
};

interface SttResponse {
  text?: string;
  detail?: { msg?: string }[] | string;
}

function cachePath(id: string): string {
  return path.join(VOICE_DIR, `${id}.mp3`);
}

export function voiceUrl(id: string): string {
  return `/api/voice/${id}`;
}

export function cachedVoice(id: string): boolean {
  return existsSync(cachePath(id));
}

export function readVoiceFile(id: string): Buffer | null {
  const file = cachePath(id);
  return existsSync(file) ? readFileSync(file) : null;
}

function errDetail(body: SttResponse | { detail?: unknown }): string | undefined {
  const detail = 'detail' in body ? body.detail : undefined;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d) => (typeof d === 'object' && d && 'msg' in d ? String(d.msg) : '')).filter(Boolean).join('; ');
  return undefined;
}

const inflight = new Map<string, Promise<SpeakResult>>();

/** Ground or rover TTS. Keys stay on the server. */
export async function synthesize(
  role: VoiceRole,
  text: string,
  apiKey: string | undefined,
): Promise<SpeakResult> {
  const trimmed = text.trim();
  const id = voiceKey(role, trimmed);
  const model = TTS_MODEL;
  if (!trimmed) return { id, role, source: 'unavailable', model, reason: 'nothing to read' };
  if (cachedVoice(id)) return { id, role, url: voiceUrl(id), source: 'cache', model };
  const pending = inflight.get(id);
  if (pending) return pending;
  if (!apiKey) return { id, role, source: 'unavailable', model, reason: 'no ElevenLabs key on the server' };

  const work = synthesizeFresh(role, trimmed, id, model, apiKey);
  inflight.set(id, work);
  try {
    return await work;
  } finally {
    inflight.delete(id);
  }
}

async function synthesizeFresh(
  role: VoiceRole,
  trimmed: string,
  id: string,
  model: string,
  apiKey: string,
): Promise<SpeakResult> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${TTS_URL}/${VOICES[role]}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
        'xi-api-key': apiKey,
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ text: trimmed, model_id: model }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as SttResponse;
      const detail = errDetail(body);
      return { id, role, source: 'unavailable', model, ms: Date.now() - t0, reason: `HTTP ${res.status}${detail ? `: ${detail}` : ''}` };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) return { id, role, source: 'unavailable', model, ms: Date.now() - t0, reason: 'empty audio' };
    mkdirSync(VOICE_DIR, { recursive: true });
    writeFileSync(cachePath(id), buf);
    return { id, role, url: voiceUrl(id), source: 'elevenlabs', ms: Date.now() - t0, model };
  } catch (err) {
    return { id, role, source: 'unavailable', model, ms: Date.now() - t0, reason: (err as Error).message };
  }
}

/** Operator intent STT. Keys stay on the server. */
export async function transcribe(
  audio: Buffer,
  mime: string,
  apiKey: string | undefined,
): Promise<TranscribeResult> {
  const model = STT_MODEL;
  if (!apiKey) return { text: '', source: 'unavailable', model, reason: 'no ElevenLabs key on the server' };
  if (audio.length < 200) return { text: '', source: 'unavailable', model, reason: 'clip is too short' };
  if (audio.length > MAX_AUDIO_BYTES) return { text: '', source: 'unavailable', model, reason: 'clip is too large' };

  const t0 = Date.now();
  try {
    const form = new FormData();
    const ext = mime.includes('mp4') ? 'mp4' : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3' : 'webm';
    form.append('model_id', model);
    form.append('language_code', 'en');
    form.append('tag_audio_events', 'false');
    form.append('file', new Blob([new Uint8Array(audio)], { type: mime || 'audio/webm' }), `intent.${ext}`);
    const res = await fetch(STT_URL, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: form,
    });
    const body = (await res.json().catch(() => ({}))) as SttResponse;
    if (!res.ok) {
      const detail = errDetail(body);
      return { text: '', source: 'unavailable', model, ms: Date.now() - t0, reason: `HTTP ${res.status}${detail ? `: ${detail}` : ''}` };
    }
    const text = body.text?.trim() ?? '';
    if (!text) return { text: '', source: 'unavailable', model, ms: Date.now() - t0, reason: 'no speech in clip' };
    return { text, source: 'elevenlabs', ms: Date.now() - t0, model };
  } catch (err) {
    return { text: '', source: 'unavailable', model, ms: Date.now() - t0, reason: (err as Error).message };
  }
}
