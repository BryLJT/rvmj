import type { Metadata } from 'next';
import { Sora } from 'next/font/google';
import { HousePromptProvider } from '../components/HousePromptProvider';
import './globals.css';

const sora = Sora({
  variable: '--font-sora',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
});

export const metadata: Metadata = {
  title: 'RVMJ Leaderboard',
  description: 'Mahjong scores and lifetime leaderboard. Tap your seat to play.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${sora.variable} h-full antialiased`}>
      <body className="min-h-full bg-canvas text-ink">
        <HousePromptProvider>{children}</HousePromptProvider>
      </body>
    </html>
  );
}
