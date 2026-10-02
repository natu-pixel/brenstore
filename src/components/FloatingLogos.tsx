import BrandLogo from './BrandLogo';
import { SERVICES } from '../data/logos';

interface FloatCfg {
  id: string;
  left: number; // % across the visual column
  top: number;
  size: number; // px
  delay: number; // s
  duration: number; // s
}

const FLOATS: FloatCfg[] = [
  { id: 'netflix', left: 13, top: 23, size: 60, delay: -1, duration: 6 },
  { id: 'spotify', left: 86, top: 23, size: 60, delay: -2.2, duration: 7 },
  { id: 'youtube', left: 90, top: 51, size: 50, delay: -5.1, duration: 6 },
  { id: 'hbo', left: 10, top: 52, size: 52, delay: -3.4, duration: 8 },
  { id: 'apple-music', left: 83, top: 78, size: 50, delay: -4, duration: 6.5 },
  { id: 'psplus', left: 50, top: 91, size: 46, delay: -2.2, duration: 7 },
  { id: 'duolingo', left: 18, top: 81, size: 46, delay: -3.1, duration: 6.5 },
  { id: 'crunchyroll', left: 48, top: 8, size: 48, delay: -1.6, duration: 7.5 },
];

const tiles = FLOATS.map(config => {
  const service = SERVICES.find(service => service.key === config.id);
  if (!service) throw new Error(`Missing floating-logo service preset: ${config.id}`);
  return { config, product: { ...service, brand_key: service.key } };
});

export default function FloatingLogos() {
  return (
    <div className="float-layer" aria-hidden="true">
      {tiles.map(({ config: f, product }) => (
          <span
            key={f.id}
            className="float-tile"
            style={{
              left: `${f.left}%`,
              top: `${f.top}%`,
              animationDelay: `${f.delay}s`,
              animationDuration: `${f.duration}s`,
            }}
          >
            <BrandLogo product={product} size={f.size} />
          </span>
      ))}
    </div>
  );
}
