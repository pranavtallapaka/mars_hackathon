import { useEffect, useState } from 'react';

type Health = { ok: boolean; keys: { xai: boolean; elevenlabs: boolean } };

export function HealthBadge() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? (r.json() as Promise<Health>) : Promise.reject()))
      .then(setHealth)
      .catch(() => setError(true));
  }, []);

  if (error) return <div className="health bad">API unreachable</div>;
  if (!health) return <div className="health muted">Checking API…</div>;
  return (
    <div className="health">
      <span className={health.ok ? 'good' : 'bad'}>API</span>
      <span className={health.keys.xai ? 'good' : 'bad'}>xAI key</span>
      <span className={health.keys.elevenlabs ? 'good' : 'bad'}>ElevenLabs key</span>
    </div>
  );
}
