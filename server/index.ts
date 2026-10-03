import 'dotenv/config';
import express from 'express';

const PORT = Number(process.env.PORT ?? 3001);

const keys = {
  xai: Boolean(process.env.XAI_API_KEY),
  elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
};

const app = express();
app.use(express.json());

// Reports only whether keys are present; never echo key values.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, keys });
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  for (const [name, loaded] of Object.entries(keys)) {
    console.log(`  ${name} key: ${loaded ? 'loaded' : 'MISSING'}`);
  }
});
