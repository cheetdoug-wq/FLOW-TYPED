// Only for offline type-checking when the "next" package can't be installed.
declare module "next" { export type Metadata = Record<string, unknown>; export type NextConfig = Record<string, unknown>; }
declare module "next/font/google" { export function Inter(o: unknown): { variable: string }; }
declare module "next/link" { const Link: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }>; export default Link; }
