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

  // Log session on mount / end
  useEffect(() => {
    supabase.from('session_logs').insert({ user_id: userId }).then(() => {})

    const handleEnd = () => {
      const mins = Math.round((Date.now() - sessionStart.current) / 60000)
      if (mins > 0) {
        navigator.sendBeacon('/api/session-end', JSON.stringify({ userId, mins }))
      }
    }
    window.addEventListener('visibilitychange', () => { if (document.hidden) handleEnd() })
    window.addEventListener('beforeunload', handleEnd)
    return () => {
      window.removeEventListener('visibilitychange', handleEnd)
      window.removeEventListener('beforeunload', handleEnd)
    }
  }, [])

  const colours = ['#e8c547', '#4ecdc4', '#ff6b9d']
  const gradients = [
    'linear-gradient(135deg,#131008 0%,#1a1a2e 100%)',
    'linear-gradient(135deg,#0a1a1a 0%,#1a1a2e 100%)',
    'linear-gradient(135deg,#1a0a12 0%,#1a1a2e 100%)',
  ]

  async function sendToCoach() {
    const subject = encodeURIComponent(`RIDE Pathway — COMPLETE — ${profile.name}`)
    const body = encodeURIComponent(
      `THE RIDE INSTRUCTOR PATHWAY — Completion Record\n\n` +
      `LEARNER: ${profile.name}\nEMAIL: \nSTARTED: ${profile.start_date || ''}\nLOCATION: ${profile.location || ''}\n\n` +
      `All 3 stages complete and signed off.\n\n— Sent from the RIDE Instructor Pathway App`
    )
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  return (
    <div style={{ background: '#0a0a12', minHeight: '100vh', paddingBottom: 80 }}>
      <Topbar name={profile.name} initials={initials} progress={pct} mode="student" />

      <div className="px-4 pt-6">
        <h1 className="font-display leading-none" style={{ fontSize: 42, letterSpacing: '0.02em', color: '#f0f0eb' }}>
          WELCOME<br />BACK,<br />{profile.name.toUpperCase()}.
        </h1>
        <p className="text-sm mt-2" style={{ color: '#7070a0' }}>Your pathway is {pct}% complete.</p>
        <p className="text-sm mt-1 italic" style={{ color: '#e8c547' }}>{stageLine}</p>
      </div>

      {/* Notification banner */}
      {latestCoachMsg && (
        <div
          className="mx-4 mt-4 rounded-xl p-3 cursor-pointer relative"
          style={{ background: '#1a1a2e', borderLeft: '3px solid #e8c547', border: '1px solid rgba(232,197,71,0.25)' }}
          onClick={() => router.push('/pathway/chat')}
        >
          <div className="text-xs font-semibold" style={{ color: '#e8c547' }}>
            🔔 Your coach left a note · {timeAgo(latestCoachMsg.created_at)}
          </div>
          <div className="text-xs mt-1 italic" style={{ color: '#7070a0' }}>
            &ldquo;{latestCoachMsg.text.substring(0, 60)}{latestCoachMsg.text.length > 60 ? '…' : ''}&rdquo;
          </div>
          <div className="text-xs font-semibold mt-2" style={{ color: '#e8c547' }}>View Message →</div>
        </div>
      )}

      {/* Overall progress */}
      <div className="mx-4 mt-4">
        <div className="flex justify-between text-[10px] uppercase tracking-widest mb-2" style={{ color: '#7070a0' }}>
          <span>Overall Progress</span>
          <span>{s3c ? 'Complete' : s2c ? 'Stage 3' : s1c ? 'Stage 2' : 'Stage 1'}</span>
        </div>
        <div className="h-1 rounded-full overflow-hidden" style={{ background: '#2a2a45' }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#e8c547,#4ecdc4,#ff6b9d)' }}
          />
        </div>
        <div className="flex justify-between text-[10px] mt-2" style={{ color: '#7070a0' }}>
          <span>Tasks: <span style={{ color: '#f0f0eb' }}>{tasks.filter(t => t.completed).length}/{STAGES.reduce((a, s) => a + s.days.reduce((b, d) => b + d.tasks.length, 0), 0)}</span></span>
          <span>Stage: <span style={{ color: '#f0f0eb' }}>{s3c ? '✓' : s2c ? '3/3' : s1c ? '2/3' : '1/3'}</span></span>
        </div>
      </div>

      {/* Stage cards */}
      <div className="flex flex-col gap-2 mx-4 mt-4">
        {STAGES.map((s, i) => {
          const { total, done, pct: sp } = countStageTasks(tasks, i)
          const complete = isStageComplete(tasks, signoffs, i)
          const unlocked = i === 0 || isStageComplete(tasks, signoffs, i - 1)
          const badge = complete ? '✓ Complete' : `${done}/${total} tasks`
          return (
            <div
              key={s.id}
              onClick={() => unlocked ? router.push(`/pathway/stage/${i}`) : null}
              className="rounded-xl overflow-hidden cursor-pointer transition-transform active:scale-[0.985]"
              style={{ background: gradients[i], border: '1px solid #2a2a45', opacity: unlocked ? 1 : 0.35 }}
            >
              <div className="p-4">
                <div className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: colours[i], opacity: 0.7 }}>{s.eyebrow}</div>
                <div className="font-display leading-[0.95] whitespace-pre-line" style={{ fontSize: 36, color: colours[i], letterSpacing: '0.02em' }}>{s.name}</div>
                <div className="text-xs mt-1.5 opacity-70">{s.tagline}</div>
              </div>
              <div className="flex items-center px-4 pb-3 gap-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="text-[9px] font-bold" style={{ color: colours[i] }}>{badge}</div>
                <div className="flex-1 h-0.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                  <div className="h-full rounded-full" style={{ width: `${sp}%`, background: colours[i], transition: 'width 0.4s' }} />
                </div>
                <div className="text-[10px] font-semibold opacity-70">{sp}%</div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Messages button */}
      <button
        onClick={() => router.push('/pathway/chat')}
        className="mx-4 mt-3 w-[calc(100%-32px)] flex items-center gap-3 rounded-xl px-4 py-3 transition-all"
        style={{ background: '#1a1a2e', border: '1px solid #2a2a45' }}
      >
        <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="#e8c547" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span className="text-sm font-semibold flex-1 text-left">Messages from your coach</span>
        {unreadFromCoach > 0 && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#e8c547', color: '#0a0a12' }}>
            {unreadFromCoach}
          </span>
        )}
      </button>

      {/* Send to Coach */}
      <div className="mx-4 mt-3">
        <button
          onClick={allComplete ? sendToCoach : undefined}
          disabled={!allComplete}
          className="w-full py-4 rounded-xl font-display text-xl transition-all disabled:opacity-25"
          style={{
            border: '2px solid #e8c547',
            background: 'linear-gradient(135deg,rgba(232,197,71,0.15),rgba(232,197,71,0.05))',
            color: '#e8c547',
            letterSpacing: '0.08em',
          }}
        >
          ✉ SEND TO COACH
        </button>
        <p className="text-center text-[11px] mt-2" style={{ color: allComplete ? '#e8c547' : '#7070a0' }}>
          {allComplete
            ? 'All stages complete — your coach is waiting.'
            : `${STAGES.reduce((a, s) => a + s.days.reduce((b, d) => b + d.tasks.length, 0), 0) - tasks.filter(t => t.completed).length} tasks remaining to unlock`}
        </p>
      </div>

      <BottomNav unreadCoach={unreadFromCoach} />
    </div>
  )
}
