'use client'

import { useRouter, usePathname } from 'next/navigation'

interface Props {
  unreadCoach?: number
}

export default function BottomNav({ unreadCoach = 0 }: Props) {
  const router = useRouter()
  const pathname = usePathname()

  const tabs = [
    {
      id: 'home', label: 'Home', href: '/pathway',
      icon: (
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      ),
    },
    {
      id: 's1', label: 'Music', href: '/pathway/stage/0',
      icon: (
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
        </svg>
      ),
    },
    {
      id: 's2', label: 'Movement', href: '/pathway/stage/1',
      icon: (
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
        </svg>
      ),
    },
    {
      id: 's3', label: 'Voice', href: '/pathway/stage/2',
      icon: (
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
        </svg>
      ),
    },
    {
      id: 'coach', label: 'Coach', href: '/pathway/chat',
      icon: (
        <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" stroke="currentColor" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      ),
      badge: unreadCoach,
    },
  ]

  function isActive(href: string) {
    if (href === '/pathway') return pathname === '/pathway'
    return pathname.startsWith(href)
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 flex z-50"
      style={{ background: '#0a0a12', borderTop: '1px solid #2a2a45', height: 60 }}
    >
      {tabs.map(tab => {
        const active = isActive(tab.href)
        return (
          <button
            key={tab.id}
            onClick={() => router.push(tab.href)}
            className="flex-1 flex flex-col items-center justify-center gap-0.5 relative"
            style={{
              color: active ? '#e8c547' : '#7070a0',
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 8,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {tab.icon}
            {tab.label}
            {tab.badge ? (
              <span
                className="absolute top-2 right-1/4 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
                style={{ background: '#e8c547', color: '#0a0a12' }}
              >
                {tab.badge > 9 ? '9+' : tab.badge}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
