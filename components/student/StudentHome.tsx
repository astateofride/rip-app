'use client'

import { useEffect, useRef, useState } from 'react'
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

// A task truly passes if: completed AND (practical task OR written answer scores ≥70%)
function taskPasses(t: TaskProgress) {
  if (!t.completed) return false
  if (t.answer !== null) return (t.score ?? 0) >= 70
  return true
}

function isStageComplete(tasks: TaskProgress[], signoffs: StageSignoff[], si: number) {
  const total = STAGES[si].days.reduce((a, d) => a + d.tasks.length, 0)
  const stageTasks = tasks.filter(t => t.stage_idx === si)
  const allSubmitted = stageTasks.filter(t => t.completed).length === total
  const allPassing = stageTasks.every(taskPasses)
  const signed = signoffs.some(s => s.stage_idx === si)
  return total > 0 && allSubmitted && allPassing && signed
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

function useLiveClock() {
  const [time, setTime] = useState('')
  useEffect(() => {
    function tick() {
      const now = new Date()
      setTime(now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return time
}

const COLOURS = ['#e8c547', '#4ecdc4', '#ff6b9d']
const GLOWS = ['rgba(232,197,71,0.18)', 'rgba(78,205,196,0.18)', 'rgba(255,107,157,0.18)']
const BORDERS = ['rgba(232,197,71,0.4)', 'rgba(78,205,196,0.4)', 'rgba(255,107,157,0.4)']

const DAYS_OF_WEEK = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export default function StudentHome({ profile, tasks, signoffs, messages, userId, onNavigateToStage }: Props & { onNavigateToStage?: (idx: number) => void }) {
  const router = useRouter()
  const supabase = createClient()
  const sessionStart = useRef(Date.now())
  const time = useLiveClock()

  const pct = overallPct(tasks)
  const initials = profile.name.trim().split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
  const firstName = profile.name.trim().split(' ')[0].toUpperCase()

  const s1c = isStageComplete(tasks, signoffs, 0)
  const s2c = isStageComplete(tasks, signoffs, 1)
  const s3c = isStageComplete(tasks, signoffs, 2)
  const allComplete = pct === 100 && s1c && s2c && s3c

  const activeStageIdx = s3c ? -1 : s2c ? 2 : s1c ? 1 : 0
  const { done: activeDone, total: activeTotal } = activeStageIdx >= 0
    ? countStageTasks(tasks, activeStageIdx)
    : { done: 0, total: 0 }

  const unreadFromCoach = messages.filter(m => m.from_role === 'coach' && !m.read).length
  const latestCoachMsg = [...messages].reverse().find(m => m.from_role === 'coach' && !m.read)
  const stagesAwaitingSignoff = [0, 1, 2].filter(si => {
    const { done, total } = countStageTasks(tasks, si)
    return done === total && total > 0 && !signoffs.some(s => s.stage_idx === si)
  })
  const totalTasks = STAGES.reduce((a, s) => a + s.days.reduce((b, d) => b + d.tasks.length, 0), 0)
  const doneTasks = tasks.filter(t => t.completed).length

  const now = new Date()
  const dateStr = `${DAYS_OF_WEEK[now.getDay()]} · ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`

  let stageLine = STAGE_LINES[0]
  if (s3c) stageLine = STAGE_LINES[3]
  else if (s2c) stageLine = STAGE_LINES[2]
  else if (s1c) stageLine = STAGE_LINES[1]

  const welcomeLines = [
    'Great to have you here. Let\'s get to work.',
    'Good to see you. Your next step is waiting.',
    'Welcome back. Every session counts.',
    'You showed up. That\'s already half the battle.',
    'Ready when you are. Let\'s keep moving.',
    'Back at it — love to see it.',
    'Your future riders will thank you for this.',
    'Consistency is what separates good from great.',
    'Here we go. Make today\'s session count.',
    'Progress happens one session at a time.',
  ]
  const welcomeLine = welcomeLines[new Date().getDate() % welcomeLines.length]

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

  async function sendToCoach() {
    const subject = encodeURIComponent(`RIDE Pathway — COMPLETE — ${profile.name}`)
    const body = encodeURIComponent(
      `THE RIDE INSTRUCTOR PATHWAY — Completion Record\n\nLEARNER: ${profile.name}\nSTARTED: ${profile.start_date || ''}\nLOCATION: ${profile.location || ''}\n\nAll 3 stages complete and signed off.\n\n— Sent from the RIDE Instructor Pathway App`
    )
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  return (
    <div style={{ background: '#080810', minHeight: '100vh', paddingBottom: 88 }}>
      <Topbar name={profile.name} initials={initials} progress={pct} mode="student" />

      <div style={{ maxWidth: 480, margin: '0 auto', padding: '0 16px' }}>

        {/* ── HERO ── */}
        <div className="pt-5 pb-2 flex items-start justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#9898c0' }}>STUDENT DASHBOARD</div>
            <h1 className="font-display leading-none" style={{ fontSize: 56, letterSpacing: '0.01em', color: '#f0f0eb', lineHeight: 0.88 }}>
              HELLO,<br /><span style={{ color: '#e8c547' }}>{profile.name.split(' ')[0].toUpperCase()}.</span>
            </h1>
            <p className="mt-3 text-sm font-semibold" style={{ color: '#9898c0' }}>
              {allComplete ? '🏆 ALL STAGES COMPLETE' : welcomeLine}
            </p>
          </div>
          <div className="text-right flex-shrink-0 pt-1">
            <div className="font-display" style={{ fontSize: 32, color: '#f0f0eb', letterSpacing: '0.02em', lineHeight: 1 }}>{time}</div>
            <div className="text-xs font-bold mt-1 uppercase tracking-widest" style={{ color: '#9898c0' }}>{dateStr}</div>
          </div>
        </div>

        {/* ── STAT CARDS ── */}
        <div className="grid grid-cols-3 gap-2 mt-4 mb-4">
          {[
            { label: 'TASKS DONE', value: doneTasks, sub: `/ ${totalTasks}`, colour: '#e8c547' },
            { label: 'COMPLETE', value: `${pct}%`, sub: 'overall', colour: '#4ecdc4' },
            { label: 'STAGE', value: activeStageIdx >= 0 ? activeStageIdx + 1 : '✓', sub: `of ${STAGES.length}`, colour: '#ff6b9d' },
          ].map(card => (
            <div key={card.label} className="rounded-2xl p-3 flex flex-col items-center justify-center"
              style={{ background: '#111120', border: `1px solid rgba(255,255,255,0.06)`, minHeight: 80 }}>
              <div className="font-display" style={{ fontSize: 36, color: card.colour, letterSpacing: '0.02em', lineHeight: 1 }}>{card.value}</div>
              <div className="text-xs font-semibold mt-1" style={{ color: '#9898c0' }}>{card.sub}</div>
              <div className="text-[9px] uppercase tracking-widest mt-0.5 font-bold" style={{ color: '#8888b0' }}>{card.label}</div>
            </div>
          ))}
        </div>

        {/* ── OVERALL PROGRESS BAR ── */}
        <div className="mb-5">
          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: '#1a1a2e' }}>
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #ffffff 0%, #3b82f6 20%, #22c55e 40%, #eab308 60%, #f97316 80%, #ef4444 100%)' }} />
          </div>
          <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest mt-1.5" style={{ color: '#8888b0' }}>
            <span>Foundations</span><span>Advanced</span><span>Mastery</span>
          </div>
        </div>

        {/* ── AWAITING SIGN-OFF ── */}
        {stagesAwaitingSignoff.length > 0 && (
          <div className="mb-4 flex flex-col gap-2">
            {stagesAwaitingSignoff.map(si => {
              const { done, total } = countStageTasks(tasks, si)
              const c = COLOURS[si]
              return (
                <div key={si} className="rounded-2xl px-4 py-3 flex items-center gap-3"
                  style={{ background: 'rgba(78,205,196,0.06)', border: '1px solid rgba(78,205,196,0.25)', borderLeft: `4px solid ${c}` }}>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: c }}>
                      {STAGES[si].eyebrow} — {STAGES[si].name.replace('\n', ' ')}
                    </div>
                    <div className="text-sm font-semibold" style={{ color: '#f0f0eb' }}>
                      ✓ All {done} tasks submitted — waiting for coach sign-off
                    </div>
                  </div>
                  <div className="text-2xl flex-shrink-0">⏳</div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── PRIMARY CTA ── */}
        {!allComplete && activeStageIdx >= 0 && (() => {
          const isFirstTime = activeDone === 0
          const c = COLOURS[activeStageIdx]
          const g = GLOWS[activeStageIdx]
          const stage = STAGES[activeStageIdx]
          return (
            <button
              onClick={() => onNavigateToStage ? onNavigateToStage(activeStageIdx) : router.push(`/pathway/stage/${activeStageIdx}`)}
              className="w-full rounded-2xl mb-4 text-left overflow-hidden"
              style={{ background: g, border: `2px solid ${c}`, boxShadow: `0 0 40px ${g}` }}>
              <div className="px-5 pt-5 pb-4">
                <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: c, opacity: 0.8 }}>
                  {isFirstTime ? '👉 START HERE' : '▶ CONTINUE WHERE YOU LEFT OFF'}
                </div>
                <div className="font-display" style={{ fontSize: 42, color: c, letterSpacing: '0.03em', lineHeight: 0.95 }}>
                  {stage.name}
                </div>
                <div className="text-sm mt-2 mb-4" style={{ color: '#c8c8dc' }}>{stage.tagline}</div>
                {/* Progress bar */}
                <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: 'rgba(255,255,255,0.08)' }}>
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${activeTotal ? Math.round(activeDone / activeTotal * 100) : 0}%`, background: c }} />
                </div>
                <div className="flex justify-between items-center">
                  <div className="text-sm font-bold" style={{ color: c }}>
                    {isFirstTime ? 'Tap to begin →' : `${activeDone} of ${activeTotal} tasks done`}
                  </div>
                  <div className="font-display text-2xl" style={{ color: c }}>
                    {activeTotal ? Math.round(activeDone / activeTotal * 100) : 0}%
                  </div>
                </div>
              </div>
            </button>
          )
        })()}

        {allComplete && (
          <button onClick={sendToCoach}
            className="w-full rounded-2xl p-5 mb-4 text-center"
            style={{ background: 'rgba(232,197,71,0.12)', border: '2px solid #e8c547', boxShadow: '0 0 40px rgba(232,197,71,0.2)' }}>
            <div className="font-display text-3xl tracking-widest" style={{ color: '#e8c547' }}>🏆 ALL DONE</div>
            <div className="text-sm mt-1 font-semibold" style={{ color: '#a0a0c0' }}>Tap to notify your coach</div>
          </button>
        )}

        {/* ── ALL STAGES ── */}
        <div className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: '#8888b0' }}>All Stages</div>
        <div className="flex flex-col gap-2 mb-5">
          {STAGES.map((s, i) => {
            const { total, done, pct: sp } = countStageTasks(tasks, i)
            const complete = isStageComplete(tasks, signoffs, i)
            const unlocked = i === 0 || isStageComplete(tasks, signoffs, i - 1)
            const isActive = unlocked && !complete
            const c = COLOURS[i]

            return (
              <button key={s.id}
                onClick={() => {
                  if (!unlocked) return
                  if (onNavigateToStage) onNavigateToStage(i)
                  else router.push(`/pathway/stage/${i}`)
                }}
                className="w-full rounded-2xl overflow-hidden text-left transition-all active:scale-[0.98]"
                style={{
                  background: '#111120',
                  border: `1px solid ${isActive ? BORDERS[i] : complete ? BORDERS[i] : 'rgba(255,255,255,0.05)'}`,
                  opacity: unlocked ? 1 : 0.3,
                  borderLeft: `4px solid ${c}`,
                }}>
                <div className="px-4 py-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="text-[9px] font-bold uppercase tracking-widest mb-0.5" style={{ color: c, opacity: 0.6 }}>{s.eyebrow}</div>
                    <div className="font-display" style={{ fontSize: 26, color: complete ? c : isActive ? c : '#9898c0', letterSpacing: '0.02em', lineHeight: 1 }}>
                      {s.name}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${sp}%`, background: c }} />
                      </div>
                      <div className="text-[10px] font-bold flex-shrink-0" style={{ color: '#8888b0' }}>{done}/{total}</div>
                    </div>
                  </div>
                  <div className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-display text-xl"
                    style={{
                      background: complete ? 'rgba(46,204,113,0.12)' : isActive ? GLOWS[i] : 'rgba(255,255,255,0.03)',
                      color: complete ? '#2ecc71' : isActive ? c : '#8888b0',
                      border: `1px solid ${complete ? 'rgba(46,204,113,0.3)' : isActive ? BORDERS[i] : 'rgba(255,255,255,0.05)'}`,
                    }}>
                    {complete ? '✓' : unlocked ? '→' : '🔒'}
                  </div>
                </div>
              </button>
            )
          })}
        </div>

        {/* ── MESSAGES BUTTON ── */}
        <button onClick={() => router.push('/pathway/chat')}
          className="w-full flex items-center gap-4 rounded-2xl px-5 py-4 mb-3 active:scale-[0.98] transition-all"
          style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.06)', borderLeft: '4px solid #e8c547' }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(232,197,71,0.1)', border: '1px solid rgba(232,197,71,0.3)' }}>
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#e8c547" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div className="flex-1 text-left">
            <div className="text-sm font-bold" style={{ color: '#f0f0eb' }}>Messages from your coach</div>
            <div className="text-xs mt-0.5" style={{ color: '#9898c0' }}>
              {unreadFromCoach > 0 ? `${unreadFromCoach} unread` : 'No new messages'}
            </div>
          </div>
          {unreadFromCoach > 0 && (
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: '#e8c547', color: '#0a0a12' }}>
              {unreadFromCoach}
            </div>
          )}
        </button>

        {/* ASOR Academy link — locked until pathway complete (all 3 stages signed off, 70%+) */}
        {s1c && s2c && s3c ? (
          <a href="https://www.astateofride.com" target="_blank" rel="noopener noreferrer"
            className="w-full flex items-center gap-4 rounded-2xl px-5 py-4 mb-3 active:scale-[0.98] transition-all"
            style={{ background: '#111120', border: '1px solid rgba(78,205,196,0.2)', borderLeft: '4px solid #4ecdc4', textDecoration: 'none' }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(78,205,196,0.1)', border: '1px solid rgba(78,205,196,0.3)' }}>
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#4ecdc4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm font-bold" style={{ color: '#4ecdc4' }}>🎓 RIDE Academy · A State of Ride</div>
              <div className="text-xs mt-0.5" style={{ color: '#9898c0' }}>Pathway complete — tap to access ↗</div>
            </div>
          </a>
        ) : (
          <div className="w-full flex items-center gap-4 rounded-2xl px-5 py-4 mb-3"
            style={{ background: '#0c0c18', border: '1px solid rgba(255,255,255,0.04)', borderLeft: '4px solid #50507a', opacity: 0.5 }}>
            <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: 18 }}>🔒</span>
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm font-bold" style={{ color: '#8888b0' }}>RIDE Academy · A State of Ride</div>
              <div className="text-xs mt-0.5" style={{ color: '#50507a' }}>Unlocks when all 3 stages are signed off at 70%+</div>
            </div>
          </div>
        )}

      </div>

      <p className="text-center text-[10px] uppercase tracking-widest pb-2" style={{ color: '#2a2a4a' }}>BETA · {process.env.NEXT_PUBLIC_GIT_HASH ?? 'dev'}</p>
      <BottomNav unreadCoach={unreadFromCoach} />
    </div>
  )
}
