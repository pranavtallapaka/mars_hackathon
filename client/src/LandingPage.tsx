import Galaxy from './components/Galaxy';

interface Props {
  onOpen: () => void;
  onEnvelope?: () => void;
}

export function LandingPage({ onOpen, onEnvelope }: Props) {
  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-galaxy" aria-hidden="true">
          <Galaxy
            mouseRepulsion={true}
            mouseInteraction={true}
            density={1.5}
            glowIntensity={0.5}
            saturation={0.8}
            hueShift={240}
            twinkleIntensity={0.4}
            rotationSpeed={0.05}
            transparent={false}
          />
        </div>

        <div className="hero-content">
          <p className="hero-eyebrow">Earth–Mars · ~20 min one-way delay</p>
          <h1 className="hero-headline">Mission control<br />that doesn't wait.</h1>
          <p className="hero-sub">
            An AI co-pilot for Mars rovers that plans, adapts, and decides in real time —
            so your mission keeps moving while the signal is still in transit.
          </p>
          <button className="hero-cta" onClick={onOpen}>
            Open mission control
          </button>
          {onEnvelope && (
            <button type="button" className="hero-secondary" onClick={onEnvelope}>
              Design an autonomy envelope
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
