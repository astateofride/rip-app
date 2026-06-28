import type { Metadata } from 'next'
import { Bebas_Neue, DM_Sans } from 'next/font/google'
import './globals.css'

const bebasNeue = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-bebas',
  display: 'swap',
})

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dmsans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'RIDE Instructor Pathway',
  description: 'ASORos RIP — Your coaching journey starts here.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${bebasNeue.variable} ${dmSans.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
