export type AppView = 'landing' | 'control' | 'envelope' | 'compare' | 'live';

export function AppNav({ current }: { current: Exclude<AppView, 'landing'> }) {
  return (
    <nav className="app-nav" aria-label="Product pages">
      <a href="#live" className={current === 'live' ? 'active' : undefined}>
        Latest from Mars
      </a>
      <a href="#control" className={current === 'control' ? 'active' : undefined}>
        Mission control
      </a>
      <a href="#envelope" className={current === 'envelope' ? 'active' : undefined}>
        Envelope agent
      </a>
    </nav>
  );
}
