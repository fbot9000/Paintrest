export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 27 29" aria-hidden>
      <rect x="0" y="14" width="7" height="15" rx="2" fill="#c3e1a3" />
      <rect x="9" y="2" width="7" height="27" rx="2" fill="#c3e1a3" />
      <rect x="18" y="9" width="7" height="20" rx="2" fill="#c3e1a3" />
    </svg>
  );
}
