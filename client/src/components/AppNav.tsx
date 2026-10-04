export type AppView = 'landing' | 'control' | 'envelope';

export function AppNav({ current }: { current: Exclude<AppView, 'landing'> }) {
  return (
    <nav className="app-nav" aria-label="Product pages">
      <a href="#control" className={current === 'control' ? 'active' : undefined}>
        Mission control
      </a>
      <a href="#envelope" className={current === 'envelope' ? 'active' : undefined}>
        Envelope agent
      </a>
    </nav>
  );
}
