import { useEffect, useState } from 'react';

type Health = { ok: boolean; keys: { xai: boolean; elevenlabs: boolean } };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Health>;
      })
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main>
      <h1>Mars Latency Mediation</h1>
      <p className="subtitle">Mission control (Batch 0 scaffold)</p>
      <section className="card">
        <h2>Backend</h2>
        {error && <p className="bad">Unreachable: {error}</p>}
        {!error && !health && <p>Checking…</p>}
        {health && (
          <ul>
            <li className={health.ok ? 'good' : 'bad'}>API: {health.ok ? 'ok' : 'down'}</li>
            <li className={health.keys.xai ? 'good' : 'bad'}>
              XAI_API_KEY: {health.keys.xai ? 'loaded' : 'missing'}
            </li>
            <li className={health.keys.elevenlabs ? 'good' : 'bad'}>
              ELEVENLABS_API_KEY: {health.keys.elevenlabs ? 'loaded' : 'missing'}
            </li>
          </ul>
        )}
      </section>
    </main>
  );
}
