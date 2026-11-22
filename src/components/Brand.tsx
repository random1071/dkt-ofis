import { useId, type CSSProperties } from 'react';

/**
 * DKT Ofis işareti: pastel pembe zemin, yumuşak açık dalga, gül tonunda serif "DKT",
 * T'nin sağ üstünde dört köşeli küçük yıldız ve harflerin altında ince kavis.
 * Uygulama ikonlarıyla aynı tasarım (scripts/icons.py).
 */
export function BrandMark({ className, style }: { className?: string; style?: CSSProperties }) {
  const id = useId().replace(/:/g, '');
  const bg = `bm-bg-${id}`;
  const ink = `bm-ink-${id}`;
  const clip = `bm-clip-${id}`;
  return (
    <svg className={className} style={style} viewBox="0 0 64 64" role="img" aria-label="DKT Ofis">
      <defs>
        <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff3ee" />
          <stop offset="0.55" stopColor="#f8d9d9" />
          <stop offset="1" stopColor="#efbcc2" />
        </linearGradient>
        <linearGradient id={ink} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#b65d72" />
          <stop offset="1" stopColor="#8f4157" />
        </linearGradient>
        <clipPath id={clip}><rect width="64" height="64" rx="14.5" /></clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="64" height="64" fill={`url(#${bg})`} />
        <path d="M46.5 0 C44 19.5 32.75 29 0 32.75 L0 0 Z" fill="#fff" fillOpacity="0.38" />
        <path d="M64 39.75 C50.5 42.25 42 49.75 37.5 64 L64 64 Z" fill="#e8a9b2" fillOpacity="0.28" />
      </g>
      <text x="31.3" y="40.5" textAnchor="middle" fontFamily="'Cormorant Garamond', Georgia, serif" fontWeight="600" fontSize="25" letterSpacing="-0.5" fill={`url(#${ink})`}>DKT</text>
      <path d="M18.25 45.25 C27.75 49 39.75 49.25 50.25 44" fill="none" stroke="#b65d72" strokeOpacity="0.5" strokeWidth="0.8" strokeLinecap="round" />
      <path d="M52.5 13.9 C52.9 16.85 52.9 16.85 55.9 17.25 C52.9 17.65 52.9 17.65 52.5 20.6 C52.1 17.65 52.1 17.65 49.1 17.25 C52.1 16.85 52.1 16.85 52.5 13.9Z" fill="#a84d63" />
    </svg>
  );
}
