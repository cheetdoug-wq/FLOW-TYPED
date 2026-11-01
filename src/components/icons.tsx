import type { ReactNode, SVGProps } from "react";

const Svg = ({ children, ...p }: SVGProps<SVGSVGElement> & { children: ReactNode }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>{children}</svg>
);
type P = SVGProps<SVGSVGElement>;
export const Sun = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Svg>;
export const Moon = (p: P) => <Svg {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></Svg>;
export const Check = (p: P) => <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>;
export const External = (p: P) => <Svg {...p}><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></Svg>;
export const Play = (p: P) => <Svg {...p}><path d="M6 4l14 8-14 8z" /></Svg>;
export const Pause = (p: P) => <Svg {...p}><path d="M7 4v16M17 4v16" /></Svg>;
export const Restart = (p: P) => <Svg {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></Svg>;
export const Shield = (p: P) => <Svg {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></Svg>;
export const DocIcon = (p: P) => <Svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h6" /></Svg>;
export const Alert = (p: P) => <Svg {...p}><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></Svg>;
export const ListBullet = (p: P) => <Svg {...p}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></Svg>;
export const ListNumber = (p: P) => <Svg {...p}><path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.5 14.5c.6-1 2.8-.8 2.7.6 0 1-2.7 2-2.7 3.9h3" /></Svg>;
export const Quote = (p: P) => <Svg {...p}><path d="M10 7H5v6h4c0 2-1 3-3 4M20 7h-5v6h4c0 2-1 3-3 4" /></Svg>;
export const LinkIcon = (p: P) => <Svg {...p}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></Svg>;
export const AlignLeft = (p: P) => <Svg {...p}><path d="M3 6h18M3 12h12M3 18h16" /></Svg>;
export const AlignCenter = (p: P) => <Svg {...p}><path d="M3 6h18M6 12h12M4 18h16" /></Svg>;
export const AlignRight = (p: P) => <Svg {...p}><path d="M3 6h18M9 12h12M5 18h16" /></Svg>;
