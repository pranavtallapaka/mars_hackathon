import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import App from './App';
import { EnvelopePage } from './components/EnvelopePage';
import { LandingPage } from './LandingPage';
import { spacetimeConnectionBuilder } from './spacetime';
import './tokens.css';
import './index.css';

type View = 'landing' | 'control' | 'envelope';

function viewFromHash(): View {
  const hash = window.location.hash.replace('#', '');
  if (hash === 'control') return 'control';
  if (hash === 'envelope') return 'envelope';
  return 'landing';
}

function Root() {
  const [view, setView] = useState<View>(viewFromHash);

  useEffect(() => {
    const handler = () => setView(viewFromHash());
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  if (view === 'control') return <App />;
  if (view === 'envelope') {
    return (
      <SpacetimeDBProvider connectionBuilder={spacetimeConnectionBuilder}>
        <EnvelopePage />
      </SpacetimeDBProvider>
    );
  }
  return (
    <LandingPage
      onOpen={() => {
        window.location.hash = 'control';
      }}
      onEnvelope={() => {
        window.location.hash = 'envelope';
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
