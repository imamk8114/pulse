const P: Record<string, string> = {
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10.3 20a2 2 0 0 0 3.4 0',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm9 16-4.3-4.3',
  sun: 'M12 4V2m0 20v-2M4 12H2m20 0h-2m-2.9-7.1 1.4-1.4M5.5 18.5l1.4-1.4m0-10.2L5.5 5.5m13 13-1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  moon: 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z',
  link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1m1 9a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
  check: 'm5 12 5 5 9-10',
  x: 'M6 6l12 12M18 6 6 18',
  flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
  play: 'M7 5v14l12-7z',
  pause: 'M8 5v14M16 5v14',
  reset: 'M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  copy: 'M9 9h10v12H9zM5 15V3h10',
  chevron: 'm9 6 6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  zap: 'M13 2 4 14h7l-1 8 9-12h-7z',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.2 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z',
};
export function Icon({ name, size = 14 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      <path d={P[name] ?? ''} />
    </svg>
  );
}
