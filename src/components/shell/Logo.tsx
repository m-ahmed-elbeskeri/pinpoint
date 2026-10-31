export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="64 64 896 896" aria-hidden="true" className="logo-mark">
      <rect x="64" y="64" width="896" height="896" rx="220" fill="#ffd60a" />
      <path d="M236 770 C 360 700, 520 836, 790 716" fill="none" stroke="#ff4f3a" strokeWidth="64" strokeLinecap="round" />
      <path d="M352 214 L352 628 L454 534 L524 690 L596 658 L528 504 L666 504 Z" fill="#111113" stroke="#111113" strokeWidth="52" strokeLinejoin="round" />
    </svg>
  );
}
