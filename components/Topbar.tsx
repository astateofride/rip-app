'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Props {
  name?: string
  initials?: string
  progress?: number
  mode?: 'student' | 'coach'
  onSave?: () => void
}

export default function Topbar({ name, initials, progress, mode = 'student', onSave }: Props) {
  const router = useRouter()
  const supabase = createClient()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const pct = progress ?? 0
  const segs = [0, 1, 2, 3, 4]

  return (
    <div
      className="sticky top-0 z-50 flex items-center justify-between px-4 gap-2"
      style={{ background: '#080810', borderBottom: '1px solid rgba(255,255,255,0.08)', height: 52 }}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={signOut}
          className="w-8 h-8 rounded-full flex items-center justify-center font-display text-base flex-shrink-0"
          style={{ background: 'rgba(232,197,71,0.1)', border: '1px solid rgba(232,197,71,0.4)', color: '#e8c547' }}
          title={name}
        >
          {initials ?? '?'}
        </button>
        <div className="leading-none">
          <div className="font-display" style={{ fontSize: 22, color: '#f0f0eb', letterSpacing: '0.08em', lineHeight: 1 }}>
            RIDE <span style={{ color: '#e8c547' }}>INSTRUCTOR</span> PATHWAY
          </div>
          <div className="text-[10px] font-bold tracking-widest mt-0.5" style={{ color: '#4a4a70', letterSpacing: '0.12em' }}>BETA · VER 1.0</div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* Mode pill */}
        <span
          className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
          style={mode === 'coach'
            ? { background: '#e8c547', color: '#080810', border: '1px solid #e8c547' }
            : { background: 'transparent', color: '#7070a0', border: '1px solid rgba(255,255,255,0.08)' }
          }
        >
          {mode}
        </span>

        {/* Progress segments */}
        {mode === 'student' && (
          <div className="flex items-center gap-1">
            <div className="flex rounded-full overflow-hidden gap-px" style={{ width: 80, height: 5, background: 'rgba(255,255,255,0.08)' }}>
              {segs.map(i => (
                <div
                  key={i}
                  className="flex-1 h-full transition-all duration-300"
                  style={{ background: pct >= (i + 1) * 20 ? '#e8c547' : (pct > i * 20 ? 'rgba(232,197,71,0.45)' : 'rgba(255,255,255,0.08)') }}
                />
              ))}
            </div>
            <span className="text-[9px] tracking-wide" style={{ color: '#7070a0', minWidth: 24, textAlign: 'right' }}>
              {pct}%
            </span>
          </div>
        )}

        <button
          onClick={onSave ?? (() => {})}
          className="text-[11px] flex items-center gap-1 px-3 py-1.5 rounded transition-all"
          style={{ border: '1px solid rgba(255,255,255,0.2)', color: '#f0f0eb', background: 'none' }}
        >
          ⇩ Save
        </button>
      </div>
    </div>
  )
}
