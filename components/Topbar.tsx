'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Props {
  name?: string
  initials?: string
  progress?: number
  mode?: 'student' | 'coach'
}

export default function Topbar({ name, initials, progress, mode = 'student' }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [showInstructions, setShowInstructions] = useState(false)

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const pct = progress ?? 0
  const segs = [0, 1, 2, 3, 4]

  return (
    <>
      <div
        className="sticky top-0 z-50 flex items-center justify-between px-4 gap-3"
        style={{ background: '#080810', borderBottom: '1px solid rgba(255,255,255,0.07)', height: 72 }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={signOut}
            className="w-9 h-9 rounded-full flex items-center justify-center font-display flex-shrink-0"
            style={{ background: 'rgba(232,197,71,0.12)', border: '1px solid rgba(232,197,71,0.45)', color: '#e8c547', fontSize: 16 }}
            title={`Sign out ${name ?? ''}`}
          >
            {initials ?? '?'}
          </button>
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-0.5 rounded-full flex-shrink-0" style={{ background: '#e8c547', height: 40 }} />
            <div className="leading-none min-w-0">
              <div className="font-display" style={{ fontSize: 11, color: '#e8c547', letterSpacing: '0.18em', marginBottom: 3 }}>
                {mode === 'coach' ? 'COACH PORTAL' : `BETA · ${process.env.NEXT_PUBLIC_GIT_HASH ?? 'dev'}`}
              </div>
              <div className="font-display" style={{ fontSize: 22, color: '#f0f0eb', letterSpacing: '0.05em', lineHeight: 1 }}>
                RIDE <span style={{ color: '#e8c547' }}>INSTRUCTOR</span>
              </div>
              <div className="font-display" style={{ fontSize: 22, color: '#f0f0eb', letterSpacing: '0.05em', lineHeight: 1 }}>
                PATHWAY
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowInstructions(true)}
            className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg transition-all active:scale-95"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', color: '#4a4a70' }}
          >
            ? Help
          </button>

          <span
            className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full flex-shrink-0"
            style={mode === 'coach'
              ? { background: '#e8c547', color: '#080810' }
              : { background: 'transparent', color: '#4a4a70', border: '1px solid rgba(255,255,255,0.08)' }
            }
          >
            {mode}
          </span>

          {mode === 'student' && (
            <div className="flex items-center gap-1.5">
              <div className="flex rounded-full overflow-hidden gap-px" style={{ width: 72, height: 4, background: 'rgba(255,255,255,0.07)' }}>
                {segs.map(i => (
                  <div key={i} className="flex-1 h-full transition-all duration-300"
                    style={{ background: pct >= (i + 1) * 20 ? '#e8c547' : pct > i * 20 ? 'rgba(232,197,71,0.35)' : 'rgba(255,255,255,0.07)' }} />
                ))}
              </div>
              <span className="text-[10px] font-bold" style={{ color: '#4a4a70', minWidth: 28, textAlign: 'right' }}>
                {pct}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Instructions modal */}
      {showInstructions && (
        <div className="fixed inset-0 z-[400] flex items-end" style={{ background: 'rgba(0,0,0,0.8)' }} onClick={() => setShowInstructions(false)}>
          <div
            className="w-full rounded-t-3xl pb-10 overflow-y-auto"
            style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.08)', maxHeight: '88vh' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 rounded-full mx-auto mt-4 mb-5" style={{ background: 'rgba(255,255,255,0.1)' }} />

            <div className="px-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#4a4a70' }}>How this works</div>
                  <div className="font-display text-3xl" style={{ color: '#e8c547', letterSpacing: '0.06em' }}>INSTRUCTIONS</div>
                </div>
                <button onClick={() => setShowInstructions(false)}
                  className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm"
                  style={{ background: 'rgba(255,255,255,0.06)', color: '#7070a0' }}>✕</button>
              </div>

              <div className="flex flex-col gap-4">
                {[
                  {
                    num: '01',
                    text: 'Work through each stage in order. Read the manual reference for each day before attempting the tasks.',
                  },
                  {
                    num: '02',
                    text: 'Some tasks require a written answer. Tap the manual reference button (📖) to expand the section notes before writing. Your answer is self-assessed against key concepts on submission.',
                  },
                  {
                    num: '03',
                    text: 'Written answers need to score 70% or above to count as passed. If you score below 70%, review the manual reference and resubmit.',
                  },
                  {
                    num: '04',
                    text: 'Video tasks: record yourself on the bike and submit a link. Use Google Drive (share → "Anyone with the link") or YouTube (set to "Unlisted" — not Private).',
                  },
                  {
                    num: '05',
                    text: 'Your coach reviews your progress, leaves notes, and signs off each stage. You cannot advance until your coach signs off.',
                  },
                  {
                    num: '06',
                    text: 'Once all 3 stages are complete and signed off at 70%+, RIDE Academy unlocks — your gateway to the full A State of Ride instructor network.',
                  },
                ].map(step => (
                  <div key={step.num} className="flex gap-4 p-4 rounded-2xl" style={{ background: '#0c0c18', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <span className="font-display text-2xl flex-shrink-0 mt-0.5" style={{ color: '#e8c547', lineHeight: 1 }}>{step.num}</span>
                    <p className="text-sm leading-relaxed" style={{ color: '#c0c0d8' }}>{step.text}</p>
                  </div>
                ))}

                {/* Video quick ref */}
                <div className="flex flex-col gap-2 mt-1">
                  <div className="flex items-start gap-3 px-4 py-3 rounded-xl" style={{ background: 'rgba(78,205,196,0.07)', border: '1px solid rgba(78,205,196,0.18)' }}>
                    <span className="text-lg flex-shrink-0">📁</span>
                    <div>
                      <div className="text-xs font-bold mb-0.5" style={{ color: '#4ecdc4' }}>Google Drive</div>
                      <div className="text-xs leading-relaxed" style={{ color: '#4a4a70' }}>Record → upload → right-click → Share → "Anyone with the link" → paste link</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 px-4 py-3 rounded-xl" style={{ background: 'rgba(255,107,157,0.07)', border: '1px solid rgba(255,107,157,0.18)' }}>
                    <span className="text-lg flex-shrink-0">▶</span>
                    <div>
                      <div className="text-xs font-bold mb-0.5" style={{ color: '#ff6b9d' }}>YouTube</div>
                      <div className="text-xs leading-relaxed" style={{ color: '#4a4a70' }}>Upload → set to <strong style={{ color: '#f0f0eb' }}>"Unlisted"</strong> (not Private) → paste link</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
