'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { STAGES, STAGE_LINES } from '@/lib/stages'
import Topbar from '@/components/Topbar'
import BottomNav from '@/components/BottomNav'
import type { Profile, TaskProgress, StageSignoff, Message, SessionLog } from '@/lib/types'

interface Props {
  profile: Profile
  tasks: TaskProgress[]
  signoffs: StageSignoff[]
  messages: Message[]
  lastSession: SessionLog | null
  userId: string
}

function countStageTasks(tasks: TaskProgress[], si: number) {
  const stageTasks = tasks.filter(t => t.stage_idx === si)
  const total = STAGES[si].days.reduce((a, d) => a + d.tasks.length, 0)
  const done = stageTasks.filter(t => t.completed).length
  return { total, done, pct: total ? Math.round(done / total * 100) : 0 }
}

function isStageComplete(tasks: TaskProgress[], signoffs: StageSignoff[], si: number) {
  const { total, done } = countStageTasks(tasks, si)
  const signed = signoffs.some(s => s.stage_idx === si)
  return total > 0 && done / total >= 0.75 && signed
}

function overallPct(tasks: TaskProgress[]) {
  const total = STAGES.reduce((a, s) => a + s.days.reduce((b, d) => b + d.tasks.length, 0), 0)
  const done = tasks.filter(t => t.completed).length
  return total ? Math.round(done / total * 100) : 0
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function StudentHome({ profile, tasks, signoffs, messages, userId }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const sessionStart = useRef(Date.now())

  const pct = overallPct(tasks)
  const initials = profile.name.trim().split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()

  const s1c = isStageComplete(tasks, signoffs, 0)
  const s2c = isStageComplete(tasks, signoffs, 1)
  const s3c = isStageComplete(tasks, signoffs, 2)
  const allComplete = pct === 100 && s1c && s2c && s3c

  let stageLine = STAGE_LINES[0]
  if (s3c) stageLine = STAGE_LINES[3]
  else if (s2c) stageLine = STAGE_LINES[2]
  else if (s1c) stageLine = STAGE_LINES[1]

  const unreadFromCoach = messages.filter(m => m.from_role === 'coach' && !m.read).length
  const latestCoachMsg = [...messages].reverse().find(m => m.from_role === 'coach')

  const totalTasks = STAGES.reduce((a, s) => a + s.days.reduce((b, d) => b + d.tasks.length, 0), 0)

  useEffect(() => {
    supabase.from('session_logs').insert({ user_id: userId }).then(() => {})
    const handleEnd = () => {
      const mins = Math.round((Date.now() - sessionStart.current) / 60000)
      if (mins > 0) navigator.sendBeacon('/api/session-end', JSON.stringify({ userId, mins }))
    }
    window.addEventListener('visibilitychange', () => { if (document.hidden) handleEnd() })
    window.addEventListener('beforeunload', handleEnd)
    return () => {
      window.removeEventListener('visibilitychange', handleEnd)
      window.removeEventListener('beforeunload', handleEnd)
    }
  }, [])

  const colours = ['#e8c547', '#4ecdc4', '#ff6b9d']
  const glows = ['rgba(232,197,71,0.15)', 'rgba(78,205,196,0.15)', 'rgba(255,107,157,0.15)']
  const borders = ['rgba(232,197,71,0.35)', 'rgba(78,205,196,0.35)', 'rgba(255,107,157,0.35)']

  async function sendToCoach() {
    const subject = encodeURIComponent(`RIDE Pathway — COMPLETE — ${profile.name}`)
    const body = encodeURIComponent(
      `THE RIDE INSTRUCTOR PATHWAY — Completion Record\n\nLEARNER: ${profile.name}\nSTARTED: ${profile.start_date || ''}\nLOCATION: ${profile.location || ''}\n\nAll 3 stages complete and signed off.\n\n— Sent from the RIDE Instructor Pathway App`
    )
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  return (
    <div style={{ background: '#0a0a12', minHeight: '100vh', paddingBottom: 80 }}>
      <Topbar name={profile.name} initials={initials} progress={pct} mode="student" />

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 16px' }}>

        {/* Hero */}
        <div className="pt-6 pb-4">
          <h1 className="font-display leading-none" style={{ fontSize: 52, letterSpacing: '0.02em', color: '#f0f0eb' }}>
            WELCOME<br />BACK,<br /><span style={{ color: '#e8c547' }}>{profile.name.toUpperCase()}.</span>
          </h1>
          <p className="text-base mt-3" style={{ color: '#7070a0' }}>Your pathway is <strong style={{ color: '#f0f0eb' }}>{pct}%</strong> complete.</p>
          <p className="text-base mt-1 italic" style={{ color: '#e8c547' }}>{stageLine}</p>
        </div>

        {/* Coach notification */}
        {latestCoachMsg && (
          <div onClick={() => router.push('/pathway/chat')}
            className="rounded-xl p-4 mb-4 cursor-pointer"
            style={{ background: '#1a1a2e', borderLeft: '3px solid #e8c547', border: '1px solid rgba(232,197,71,0.25)' }}>
            <div className="text-sm font-semibold" style={{ color: '#e8c547' }}>
              🔔 Your coach left a note · {timeAgo(latestCoachMsg.created_at)}
            </div>
            <div className="text-sm mt-1 italic" style={{ color: '#7070a0' }}>
              "{latestCoachMsg.text.substring(0, 80)}{latestCoachMsg.text.length > 80 ? '…' : ''}"
            </div>
            <div className="text-sm font-semibold mt-2" style={{ color: '#e8c547' }}>View Message →</div>
          </div>
        )}

        {/* Overall progress */}
        <div className="mb-5">
          <div className="flex justify-between text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#7070a0' }}>
            <span>Overall Progress</span>
            <span style={{ color: '#f0f0eb' }}>{tasks.filter(t => t.completed).length} / {totalTasks} tasks</span>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: '#2a2a45' }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#e8c547,#4ecdc4,#ff6b9d)' }} />
          </div>
        </div>

        {/* Stage cards */}
        <div className="flex flex-col gap-3 mb-4">
          {STAGES.map((s, i) => {
            const { total, done, pct: sp } = countStageTasks(tasks, i)
            const complete = isStageComplete(tasks, signoffs, i)
            const unlocked = i === 0 || isStageComplete(tasks, signoffs, i - 1)
            const isActive = unlocked && !complete

            return (
              <div key={s.id}
                onClick={() => unlocked ? router.push(`/pathway/stage/${i}`) : undefined}
                className="rounded-2xl overflow-hidden transition-all duration-200"
                style={{
                  background: isActive ? glows[i] : '#1a1a2e',
                  border: `1px solid ${isActive ? borders[i] : complete ? borders[i] : '#2a2a45'}`,
                  opacity: unlocked ? 1 : 0.3,
                  cursor: unlocked ? 'pointer' : 'default',
                  boxShadow: isActive ? `0 0 24px ${glows[i]}` : 'none',
                  transform: 'translateY(0)',
                }}>
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: colours[i], opacity: 0.7 }}>{s.eyebrow}</div>
                      <div className="font-display leading-none" style={{ fontSize: 44, color: colours[i], letterSpacing: '0.02em' }}>
                        {s.name}
                      </div>
                    </div>
                    {complete && (
                      <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-base flex-shrink-0 mt-1"
                        style={{ background: 'rgba(46,204,113,0.15)', border: '1px solid rgba(46,204,113,0.4)', color: '#2ecc71' }}>✓</div>
                    )}
                    {isActive && (
                      <div className="text-xs font-bold px-2 py-1 rounded-full flex-shrink-0 mt-1"
                        style={{ background: colours[i], color: '#0a0a12' }}>ACTIVE</div>
                    )}
                  </div>
                  <p className="text-sm mb-4" style={{ color: '#7070a0' }}>{s.tagline}</p>

                  {/* Progress bar */}
                  <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${sp}%`, background: colours[i] }} />
                  </div>
                  <div className="flex justify-between text-xs font-semibold" style={{ color: colours[i] }}>
                    <span>{done}/{total} tasks</span>
                    <span>{sp}%</span>
                  </div>
                </div>

                {unlocked && (
                  <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: `1px solid rgba(255,255,255,0.06)` }}>
                    <span className="text-xs font-bold uppercase tracking-widest" style={{ color: complete ? '#2ecc71' : colours[i] }}>
                      {complete ? '✓ Complete' : isActive ? 'In progress →' : 'Start →'}
                    </span>
                    {!complete && (
                      <span className="text-xs" style={{ color: '#7070a0' }}>{total - done} remaining</span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Messages button */}
        <button onClick={() => router.push('/pathway/chat')}
          className="w-full flex items-center gap-3 rounded-xl px-5 py-4 mb-3 transition-all"
          style={{ background: '#1a1a2e', border: '1px solid #2a2a45' }}>
          <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="#e8c547" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span className="text-base font-semibold flex-1 text-left">Messages from your coach</span>
          {unreadFromCoach > 0 && (
            <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: '#e8c547', color: '#0a0a12' }}>
              {unreadFromCoach}
            </span>
          )}
        </button>

        {/* Send to coach */}
        <button onClick={allComplete ? sendToCoach : undefined} disabled={!allComplete}
          className="w-full py-5 rounded-xl font-display text-2xl transition-all disabled:opacity-25"
          style={{ border: '2px solid #e8c547', background: allComplete ? 'rgba(232,197,71,0.12)' : 'transparent', color: '#e8c547', letterSpacing: '0.08em' }}>
          ✉ SEND TO COACH
        </button>
        <p className="text-center text-sm mt-2" style={{ color: allComplete ? '#e8c547' : '#7070a0' }}>
          {allComplete ? 'All stages complete — your coach is waiting.' : `${totalTasks - tasks.filter(t => t.completed).length} tasks remaining to unlock`}
        </p>

      </div>

      <BottomNav unreadCoach={unreadFromCoach} />
    </div>
  )
}
