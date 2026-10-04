import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import App from './App';
import { ComparePage } from './compare/ComparePage';
import { EnvelopePage } from './components/EnvelopePage';
import { LandingPage } from './LandingPage';
import { LivePage } from './live/LivePage';
import { spacetimeConnectionBuilder } from './spacetime';
import './tokens.css';
import './index.css';

type View = 'landing' | 'control' | 'envelope' | 'compare' | 'live';

function pathIsLive(): boolean {
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '/live';
}

function viewFromLocation(): View {
  const hash = window.location.hash.replace('#', '');
  if (hash === 'live' || pathIsLive()) return 'live';
  if (hash === 'control') return 'control';
  if (hash === 'envelope') return 'envelope';
  if (hash === 'compare') return 'compare';
  return 'landing';
}

function Root() {
  const [view, setView] = useState<View>(viewFromLocation);

  useEffect(() => {
    if (pathIsLive() && window.location.hash !== '#live') {
      window.history.replaceState(null, '', '/#live');
    }
    const handler = () => setView(viewFromLocation());
    window.addEventListener('hashchange', handler);
    window.addEventListener('popstate', handler);
    return () => {
      window.removeEventListener('hashchange', handler);
      window.removeEventListener('popstate', handler);
    };
  }, []);

  if (view === 'compare') return <ComparePage />;

  if (view === 'control' || view === 'envelope' || view === 'live') {
    return (
      <SpacetimeDBProvider connectionBuilder={spacetimeConnectionBuilder}>
        {view === 'control' ? <App /> : view === 'envelope' ? <EnvelopePage /> : <LivePage />}
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
      onLive={() => {
        window.location.hash = 'live';
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
