import { useId, type CSSProperties } from 'react';

/** DKT Ofis işareti: gül kurusu zemin üzerinde fildişi "DKT" monogramı ve ince ayraç çizgisi */
export function BrandMark({ className, style }: { className?: string; style?: CSSProperties }) {
  const gid = `bm-${useId().replace(/:/g, '')}`;
  return (
    <svg className={className} style={style} viewBox="0 0 64 64" role="img" aria-label="DKT Ofis">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c09391" />
          <stop offset="1" stopColor="#93605e" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill={`url(#${gid})`} />
      <text x="32" y="38" textAnchor="middle" fontFamily="'Cormorant Garamond', Georgia, serif" fontWeight="600" fontSize="24" letterSpacing="0.8" fill="#fbf4f0">DKT</text>
      <line x1="24" y1="45.5" x2="40" y2="45.5" stroke="#fbf4f0" strokeOpacity="0.7" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}
