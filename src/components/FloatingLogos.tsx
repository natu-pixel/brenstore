import BrandLogo from './BrandLogo';
import { useResource } from '../features/api';

interface FloatCfg {
  id: string;
  left: number; // % across the visual column
  size: number; // px
  delay: number; // s
  duration: number; // s
}

const FLOATS: FloatCfg[] = [
  { id: 'netflix', left: 4, size: 52, delay: 0, duration: 11 },
  { id: 'spotify', left: 88, size: 56, delay: 2.2, duration: 12.5 },
  { id: 'youtube', left: 72, size: 44, delay: 5.1, duration: 10 },
  { id: 'hbo', left: 14, size: 48, delay: 7.4, duration: 13 },
  { id: 'apple-music', left: 94, size: 42, delay: 4.0, duration: 9.5 },
  { id: 'psplus', left: 60, size: 46, delay: 9.2, duration: 12 },
  { id: 'duolingo', left: 30, size: 40, delay: 3.1, duration: 10.5 },
  { id: 'crunchyroll', left: 80, size: 50, delay: 6.6, duration: 11.5 },
];

export default function FloatingLogos() {
  const catalog = useResource('catalog');
  return (
    <div className="float-layer" aria-hidden="true">
      {FLOATS.map((f, index) => {
        const p = catalog.data?.[index];
        if (!p) return null;
        return (
          <span
            key={f.id}
            className="float-tile"
            style={{
              left: `${f.left}%`,
              animationDelay: `${f.delay}s`,
              animationDuration: `${f.duration}s`,
            }}
          >
            <BrandLogo product={p} size={f.size} />
          </span>
        );
      })}
    </div>
  );
}
