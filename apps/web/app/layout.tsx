import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono, Noto_Sans_Bengali } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });
// Bangla glyphs for shareholder names and questions.
const bengali = Noto_Sans_Bengali({ subsets: ['bengali'], variable: '--font-bengali', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'IRM · AGM/EGM', template: '%s · IRM' },
  description: 'Digital AGM and EGM management for companies in Bangladesh.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: '#f7f7f5', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${bengali.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
