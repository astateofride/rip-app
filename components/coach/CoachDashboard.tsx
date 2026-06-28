'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { STAGES } from '@/lib/stages'
import type { Profile, TaskProgress, DayData, CoachRemark, StageSignoff, Message, SessionLog } from '@/lib/types'

interface Props {
  coach: Profile
  students: Profile[]
  allTasks: TaskProgress[]
  allDayData: DayData[]
  allRemarks: CoachRemark[]
  allSignoffs: StageSignoff[]
  allMessages: Message[]
  lastSessions: SessionLog[]
  coachId: string
}

type Tab = 'overview' | 'review' | 'messages'

interface QueueItem {
  student: Profile
  si: number
  di: number
}

function timeAgo(iso: string | null | undefined) {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function useClock() {
  const [time, setTime] = useState('')
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase())
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return time
}

const colours = ['#e8c547', '#4ecdc4', '#ff6b9d']
const stageNames = ['Mastering Music', 'Magic in Movement', 'Finding Your Voice']

export default function CoachDashboard({ coach, students, allTasks, allDayData, allRemarks, allSignoffs, allMessages, lastSessions, coachId }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const time = useClock()
  const [tab, setTab] = useState<Tab>('overview')
  const [selectedStudentId, setSelectedStudentId] = useState<string>(students[0]?.id ?? '')
  const [remarks, setRemarks] = useState<CoachRemark[]>(allRemarks)
  const [signoffs, setSignoffs] = useState<StageSignoff[]>(allSignoffs)
  const [messages, setMessages] = useState<Message[]>(allMessages)
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set())
  const [signoffModal, setSignoffModal] = useState<{ stageIdx: number; studentId: string } | null>(null)
  const [signoffNote, setSignoffNote] = useState('')
  const [chatText, setChatText] = useState('')
  const [sending, setSending] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [profileSheet, setProfileSheet] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', location: '', start_date: '', email: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [localStudents, setLocalStudents] = useState<Profile[]>(students)
  const [reviewQueue, setReviewQueue] = useState<QueueItem[]>([])
  const [queueIdx, setQueueIdx] = useState(0)
  const [queueNote, setQueueNote] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const student = localStudents.find(s => s.id === selectedStudentId)
  const lastSession = lastSessions.find(s => s.user_id === selectedStudentId)
  const unreadCount = messages.filter(m => m.student_id === selectedStudentId && m.from_role === 'student' && !m.read).length
  const totalUnread = messages.filter(m => m.from_role === 'student' && !m.read).length
  const coachInitials = coach.name.trim().split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase()
  const today = new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, tab])

  useEffect(() => {
    if (!selectedStudentId) return
    const channel = supabase.channel('coach-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `student_id=eq.${selectedStudentId}` },
        payload => setMessages(prev => prev.some(m => m.id === (payload.new as Message).id) ? prev : [...prev, payload.new as Message]))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [selectedStudentId])

  useEffect(() => {
    if (tab === 'messages' && selectedStudentId) {
      supabase.from('messages').update({ read: true }).eq('student_id', selectedStudentId).eq('from_role', 'student').eq('read', false).then(() => {})
    }
  }, [tab, selectedStudentId])

  function countTasks(studentId: string, si: number) {
    const total = STAGES[si].days.reduce((a, d) => a + d.tasks.length, 0)
    const stageTasks = allTasks.filter(t => t.student_id === studentId && t.stage_idx === si)
    // "done" = completed practical tasks OR written tasks with score >= 60 OR coach has remarked on that day
    const done = stageTasks.filter(t => {
      if (!t.completed) return false
      if (t.answer !== null) {
        const coachReviewed = remarks.some(r => r.student_id === studentId && r.stage_idx === si && r.day_idx === t.day_idx)
        return coachReviewed || (t.score ?? 0) >= 60
      }
      return true
    }).length
    const completed = stageTasks.filter(t => t.completed).length
    return { total, done, completed, pct: total ? Math.round(done / total * 100) : 0 }
  }

  function getSignoff(studentId: string, si: number) {
    return signoffs.find(s => s.student_id === studentId && s.stage_idx === si)
  }

  async function saveRemark(studentId: string, si: number, di: number, remark: string) {
    const key = `${studentId}-${si}-${di}`
    setSaving(key)
    const { data } = await supabase.from('coach_remarks').upsert(
      { student_id: studentId, coach_id: coachId, stage_idx: si, day_idx: di, remark },
      { onConflict: 'student_id,stage_idx,day_idx' }
    ).select().single()
    if (data) {
      setRemarks(prev => {
        const idx = prev.findIndex(r => r.student_id === studentId && r.stage_idx === si && r.day_idx === di)
        if (idx >= 0) { const n = [...prev]; n[idx] = data as CoachRemark; return n }
        return [...prev, data as CoachRemark]
      })
    }
    setSaving(null)
    setExpandedDays(prev => { const n = new Set(prev); n.delete(`${studentId}-${si}-${di}`); return n })
  }

  async function confirmSignoff() {
    if (!signoffModal) return
    const { stageIdx, studentId } = signoffModal
    const { data } = await supabase.from('stage_signoffs').insert({
      student_id: studentId, coach_id: coachId, stage_idx: stageIdx, note: signoffNote || null,
    }).select().single()
    if (data) setSignoffs(prev => [...prev, data as StageSignoff])
    setSignoffModal(null)
    setSignoffNote('')
  }

  async function revokeSignoff(studentId: string, stageIdx: number) {
    const signoff = signoffs.find(s => s.student_id === studentId && s.stage_idx === stageIdx)
    if (!signoff) return
    await supabase.from('stage_signoffs').delete().eq('id', signoff.id)
    setSignoffs(prev => prev.filter(s => s.id !== signoff.id))
  }

  async function sendMessage() {
    const trimmed = chatText.trim()
    if (!trimmed || sending || !selectedStudentId) return
    setSending(true)
    setChatText('')
    const { data } = await supabase.from('messages').insert({
      student_id: selectedStudentId, sender_id: coachId, from_role: 'coach', text: trimmed,
    }).select().single()
    if (data) setMessages(prev => [...prev, data as Message])
    setSending(false)
  }

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  function openProfile(studentId: string) {
    const s = localStudents.find(x => x.id === studentId)
    if (!s) return
    setEditForm({ name: s.name, location: s.location ?? '', start_date: s.start_date ?? '', email: s.email ?? '' })
    setEditMode(false)
    setProfileSheet(studentId)
  }

  async function saveEdit() {
    if (!profileSheet) return
    setEditSaving(true)
    await supabase.from('profiles').update({
      name: editForm.name,
      location: editForm.location || null,
      start_date: editForm.start_date || null,
    }).eq('id', profileSheet)
    setLocalStudents(prev => prev.map(s => s.id === profileSheet
      ? { ...s, name: editForm.name, location: editForm.location || null, start_date: editForm.start_date || null }
      : s))
    setEditMode(false)
    setEditSaving(false)
  }

  function buildQueue(startStudentId?: string): QueueItem[] {
    const items: QueueItem[] = []
    const ordered = startStudentId
      ? [localStudents.find(s => s.id === startStudentId)!, ...localStudents.filter(s => s.id !== startStudentId)]
      : localStudents
    for (const student of ordered) {
      if (!student) continue
      for (let si = 0; si < 3; si++) {
        if (getSignoff(student.id, si)) continue
        for (let di = 0; di < STAGES[si].days.length; di++) {
          const hasDone = allTasks.some(t => t.student_id === student.id && t.stage_idx === si && t.day_idx === di && t.completed)
          if (!hasDone) continue
          items.push({ student, si, di })
        }
      }
    }
    // unremarked first
    return items.sort((a, b) => {
      const aR = remarks.some(r => r.student_id === a.student.id && r.stage_idx === a.si && r.day_idx === a.di) ? 1 : 0
      const bR = remarks.some(r => r.student_id === b.student.id && r.stage_idx === b.si && r.day_idx === b.di) ? 1 : 0
      return aR - bR
    })
  }

  function startReview(startStudentId?: string) {
    const queue = buildQueue(startStudentId)
    setReviewQueue(queue)
    setQueueIdx(0)
    if (queue.length > 0) {
      const first = queue[0]
      const existing = remarks.find(r => r.student_id === first.student.id && r.stage_idx === first.si && r.day_idx === first.di)
      setQueueNote(existing?.remark ?? '')
    }
    setTab('review')
  }

  // compute per-student message threads for the home view
  const allUnread = messages.filter(m => m.from_role === 'student' && !m.read)

  // Summary stats
  const totalStudents = localStudents.length
  const totalSignoffs = signoffs.length
  const pendingSignoffs = localStudents.reduce((acc, s) => {
    return acc + [0,1,2].filter(si => {
      const { pct } = countTasks(s.id, si)
      return pct >= 75 && !getSignoff(s.id, si)
    }).length
  }, 0)

  return (
    <div style={{ background: '#080810', minHeight: '100vh', paddingBottom: 80 }}>

      {/* Topbar */}
      <div className="sticky top-0 z-50" style={{ background: '#080810', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center justify-between px-4 gap-3" style={{ height: 60 }}>
          {/* Left: avatar sign-out + brand */}
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={signOut}
              className="w-9 h-9 rounded-full flex items-center justify-center font-display flex-shrink-0"
              style={{ background: 'rgba(232,197,71,0.12)', border: '1px solid rgba(232,197,71,0.45)', color: '#e8c547', fontSize: 16 }}
              title={`Sign out ${coach.name}`}>
              {coachInitials}
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-0.5 rounded-full flex-shrink-0" style={{ background: '#e8c547', height: 28 }} />
              <div className="leading-none min-w-0">
                <div className="font-display" style={{ fontSize: 10, color: '#e8c547', letterSpacing: '0.18em', marginBottom: 2 }}>COACH PORTAL</div>
                <div className="font-display" style={{ fontSize: 16, color: '#f0f0eb', letterSpacing: '0.05em', lineHeight: 1.1 }}>RIDE <span style={{ color: '#e8c547' }}>INSTRUCTOR</span> PATHWAY</div>
              </div>
            </div>
          </div>
          {/* Right: student view + badge */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <a href="/coach/preview"
              className="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-lg active:scale-95 transition-all"
              style={{ border: '1px solid rgba(232,197,71,0.3)', color: '#e8c547', background: 'rgba(232,197,71,0.06)' }}>
              👁 Preview
            </a>
            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full" style={{ background: '#e8c547', color: '#080810' }}>COACH</span>
          </div>
        </div>
      </div>

      {tab === 'messages' && student ? (
        /* ── MESSAGES FULL SCREEN ── */
        <div className="flex flex-col" style={{ height: 'calc(100dvh - 60px)' }}>
          <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: '1px solid #1a1a2e', flexShrink: 0 }}>
            <button onClick={() => setTab('overview')}
              className="flex items-center justify-center rounded-xl flex-shrink-0 font-bold active:scale-95 transition-all"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', color: '#9898c0', minWidth: 44, minHeight: 44, fontSize: 20 }}>
              ←
            </button>
            <div className="font-display tracking-wide" style={{ fontSize: 26, color: '#f0f0eb', letterSpacing: '0.06em' }}>
              MESSAGES — <span style={{ color: '#e8c547' }}>{student.name.split(' ')[0].toUpperCase()}</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
            {messages.filter(m => m.student_id === selectedStudentId).length === 0
              ? <div className="flex-1 flex items-center justify-center text-base" style={{ color: '#7878a8' }}>No messages yet</div>
              : messages.filter(m => m.student_id === selectedStudentId).map(m => {
                const fromMe = m.from_role === 'coach'
                const stageName = m.stage_ref !== null && m.day_ref !== null ? `Stage ${m.stage_ref + 1} · Day ${m.stage_ref * 10 + (m.day_ref ?? 0) + 1}` : null
                return (
                  <div key={m.id} className={`flex flex-col ${fromMe ? 'items-end' : 'items-start'}`}>
                    {stageName && <span className="text-xs uppercase tracking-widest px-2 py-1 rounded mb-1 font-bold" style={{ background: 'rgba(255,255,255,0.05)', color: '#7878a8' }}>{stageName}</span>}
                    <div className="max-w-[82%] px-4 py-3 rounded-2xl text-base leading-snug"
                      style={fromMe
                        ? { background: 'rgba(232,197,71,0.12)', border: '1px solid rgba(232,197,71,0.3)', color: '#f0f0eb', borderBottomRightRadius: 4 }
                        : { background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.07)', color: '#f0f0eb', borderBottomLeftRadius: 4 }}>
                      {m.text}
                    </div>
                    <div className="text-xs mt-1 font-semibold" style={{ color: '#60608a' }}>{timeAgo(m.created_at)}</div>
                  </div>
                )
              })}
            <div ref={messagesEndRef} />
          </div>
          <div className="flex gap-2 px-4 pt-3 pb-4 items-end" style={{ borderTop: '1px solid #1a1a2e', flexShrink: 0 }}>
            <textarea value={chatText} onChange={e => setChatText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              placeholder={`Message ${student.name.split(' ')[0]}…`} rows={1} className="inp flex-1"
              style={{ minHeight: 48, maxHeight: 120, resize: 'none', fontSize: 15 }} />
            <button onClick={sendMessage} disabled={!chatText.trim() || sending}
              className="font-display text-lg px-5 rounded-xl disabled:opacity-40 active:scale-95 transition-all"
              style={{ background: '#e8c547', color: '#0a0a12', minHeight: 48, letterSpacing: '0.04em' }}>
              SEND
            </button>
          </div>
        </div>
      ) : tab === 'review' ? (
        /* ── GAMIFIED REVIEW QUEUE ── */
        (() => {
          const item = reviewQueue[queueIdx]
          const isAllDone = reviewQueue.length === 0 || queueIdx >= reviewQueue.length

          if (isAllDone) {
            return (
              <div className="flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: 'calc(100dvh - 60px)' }}>
                <div className="font-display text-6xl mb-4" style={{ color: '#2ecc71', letterSpacing: '0.04em' }}>ALL CLEAR</div>
                <p className="text-base mb-8" style={{ color: '#9898c0' }}>Nothing left in the queue. Your students are moving.</p>
                <button onClick={() => setTab('overview')}
                  className="font-display text-2xl tracking-widest px-8 py-4 rounded-2xl active:scale-[0.98] transition-all"
                  style={{ background: '#e8c547', color: '#080810', letterSpacing: '0.06em' }}>
                  ← BACK TO OVERVIEW
                </button>
              </div>
            )
          }

          const { student: qs, si, di } = item
          const day = STAGES[si].days[di]
          const dayNum = String(si * 10 + di + 1).padStart(2, '0')
          const colour = colours[si]
          const dayDataRow = allDayData.find(d => d.student_id === qs.id && d.stage_idx === si && d.day_idx === di)
          const existingRemark = remarks.find(r => r.student_id === qs.id && r.stage_idx === si && r.day_idx === di)
          const completedTasks = allTasks.filter(t => t.student_id === qs.id && t.stage_idx === si && t.day_idx === di && t.completed)
          const incompleteTasks = day.tasks.filter((_, ti) => !allTasks.find(t => t.student_id === qs.id && t.stage_idx === si && t.day_idx === di && t.task_idx === ti && t.completed))
          const writtenAnswers = day.tasks.map((task, ti) => {
            const prog = allTasks.find(t => t.student_id === qs.id && t.stage_idx === si && t.day_idx === di && t.task_idx === ti)
            if (!prog?.answer) return null
            return { ti, task, prog, needsWork: (prog.score ?? 0) < 60 }
          }).filter(Boolean)
          const { done: stageDone, total: stageTotal } = countTasks(qs.id, si)
          const stageComplete = stageDone === stageTotal && stageTotal > 0 && !getSignoff(qs.id, si)

          async function saveAndNext() {
            const key = `${qs.id}-${si}-${di}`
            setSaving(key)
            await saveRemark(qs.id, si, di, queueNote)
            setSaving(null)
            const next = queueIdx + 1
            setQueueIdx(next)
            if (next < reviewQueue.length) {
              const nextItem = reviewQueue[next]
              const nextExisting = remarks.find(r => r.student_id === nextItem.student.id && r.stage_idx === nextItem.si && r.day_idx === nextItem.di)
              setQueueNote(nextExisting?.remark ?? '')
            }
          }

          function skip() {
            const next = queueIdx + 1
            setQueueIdx(next)
            if (next < reviewQueue.length) {
              const nextItem = reviewQueue[next]
              const nextExisting = remarks.find(r => r.student_id === nextItem.student.id && r.stage_idx === nextItem.si && r.day_idx === nextItem.di)
              setQueueNote(nextExisting?.remark ?? '')
            }
          }

          const savingKey = `${qs.id}-${si}-${di}`

          return (
            <div className="flex flex-col pb-10" style={{ minHeight: 'calc(100dvh - 60px)' }}>
              {/* Queue progress bar */}
              <div style={{ background: '#111120', borderBottom: '1px solid #1a1a2e' }}>
                <div className="flex items-center justify-between px-4 py-3">
                  <button onClick={() => setTab('overview')}
                    className="text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg active:scale-95 transition-all"
                    style={{ color: '#9898c0', border: '1px solid rgba(255,255,255,0.07)', background: 'none' }}>
                    ← Exit
                  </button>
                  <div className="text-xs font-bold uppercase tracking-widest" style={{ color: '#9898c0' }}>
                    {queueIdx + 1} / {reviewQueue.length}
                  </div>
                  {queueIdx > 0 && (
                    <button onClick={() => { setQueueIdx(queueIdx - 1); const prev = reviewQueue[queueIdx - 1]; setQueueNote(remarks.find(r => r.student_id === prev.student.id && r.stage_idx === prev.si && r.day_idx === prev.di)?.remark ?? '') }}
                      className="text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg active:scale-95 transition-all"
                      style={{ color: '#9898c0', border: '1px solid rgba(255,255,255,0.07)', background: 'none' }}>
                      ← Prev
                    </button>
                  )}
                  {queueIdx === 0 && <div style={{ width: 60 }} />}
                </div>
                <div style={{ height: 3, background: '#1a1a2e' }}>
                  <div style={{ height: '100%', width: `${((queueIdx) / reviewQueue.length) * 100}%`, background: colour, transition: 'width 0.4s ease' }} />
                </div>
              </div>

              <div className="px-4 pt-5 flex flex-col gap-4 flex-1">
                {/* Student + context */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: colour }}>
                      STAGE {si + 1} · DAY {dayNum}
                    </div>
                    <div className="font-display leading-none mb-1" style={{ fontSize: 36, color: '#f0f0eb', letterSpacing: '0.02em' }}>
                      {qs.name.split(' ')[0].toUpperCase()}
                    </div>
                    <div className="text-sm font-semibold" style={{ color: '#9898c0' }}>{qs.location ?? ''}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: '#8888b0' }}>Last active</div>
                    <div className="text-sm font-bold" style={{ color: '#4ecdc4' }}>{timeAgo(lastSessions.find(x => x.user_id === qs.id)?.started_at)}</div>
                  </div>
                </div>

                {/* Day title */}
                <div className="rounded-2xl px-4 py-4" style={{ background: '#111120', border: `1px solid rgba(255,255,255,0.06)`, borderLeft: `4px solid ${colour}` }}>
                  <div className="font-display text-2xl leading-tight mb-1" style={{ color: colour, letterSpacing: '0.04em' }}>{day.title}</div>
                  <div className="text-xs font-bold uppercase tracking-widest" style={{ color: '#8888b0' }}>
                    {completedTasks.length}/{day.tasks.length} tasks · {stageNames[si]}
                    {dayDataRow?.manual_read_at ? ' · 📖 manual read' : ''}
                    {existingRemark ? ' · ✓ note left' : ''}
                  </div>
                </div>

                {/* Video submission */}
                {dayDataRow?.video_url && (
                  <div className="rounded-xl px-4 py-3" style={{ background: '#0c0c18', border: '1px solid rgba(78,205,196,0.2)' }}>
                    <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#4ecdc4' }}>▶ Video Submission</div>
                    <a href={dayDataRow.video_url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold underline truncate block" style={{ color: '#4ecdc4' }}>{dayDataRow.video_url}</a>
                  </div>
                )}

                {/* Student reflection */}
                {dayDataRow?.reflection && (
                  <div className="rounded-xl px-4 py-3" style={{ background: '#0c0c18', border: '1px solid rgba(255,255,255,0.06)', borderLeft: '2px solid rgba(255,255,255,0.12)' }}>
                    <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#8888b0' }}>Student Reflection</div>
                    <p className="text-sm italic leading-relaxed" style={{ color: '#c0c0d8' }}>{dayDataRow.reflection}</p>
                  </div>
                )}

                {/* Written answers */}
                {writtenAnswers.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <div className="text-xs font-bold uppercase tracking-widest" style={{ color: '#8888b0' }}>Written Answers</div>
                    {writtenAnswers.map(item => {
                      if (!item) return null
                      const { ti, task, prog, needsWork } = item
                      return (
                        <div key={ti} className="rounded-xl p-4" style={{ background: '#0c0c18', border: `1px solid ${needsWork ? 'rgba(255,107,157,0.3)' : 'rgba(46,204,113,0.2)'}` }}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8888b0' }}>Task {ti + 1}</span>
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={needsWork
                              ? { background: 'rgba(255,107,157,0.12)', color: '#ff6b9d', border: '1px solid rgba(255,107,157,0.3)' }
                              : { background: 'rgba(46,204,113,0.1)', color: '#2ecc71', border: '1px solid rgba(46,204,113,0.25)' }}>
                              {prog.score ?? 0}% {needsWork ? '· needs work' : '✓ passed'}
                            </span>
                          </div>
                          <p className="text-[11px] leading-snug mb-2.5" style={{ color: '#6868a0' }}>{task.text}</p>
                          <p className="text-sm leading-relaxed" style={{ color: needsWork ? '#f0f0eb' : '#a0a0c0' }}>{prog.answer}</p>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Incomplete tasks still to do */}
                {incompleteTasks.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <div className="text-xs font-bold uppercase tracking-widest" style={{ color: '#8888b0' }}>Still to complete</div>
                    {incompleteTasks.map((task, i) => (
                      <div key={i} className="flex items-start gap-3 px-3 py-2.5 rounded-xl" style={{ background: '#0c0c18', border: '1px solid #1a1a2e', opacity: 0.7 }}>
                        <div className="w-5 h-5 rounded-full border flex-shrink-0 mt-0.5" style={{ borderColor: '#2a2a4a' }} />
                        <p className="text-sm leading-snug" style={{ color: '#9898c0' }}>{task.text}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Coach note */}
                <div>
                  <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#8888b0' }}>
                    {existingRemark ? 'Your note (edit to update)' : 'Leave a coaching note'}
                  </div>
                  <textarea
                    className="inp"
                    value={queueNote}
                    onChange={e => setQueueNote(e.target.value)}
                    placeholder="What feedback do you have for this day?…"
                    style={{ minHeight: 90, fontSize: 15 }}
                  />
                </div>

                {/* Sign off prompt */}
                {stageComplete && (
                  <div className="rounded-2xl px-4 py-4 flex items-center justify-between gap-3" style={{ background: 'rgba(46,204,113,0.06)', border: '1px solid rgba(46,204,113,0.25)' }}>
                    <div>
                      <div className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: '#2ecc71' }}>Stage {si + 1} complete</div>
                      <div className="text-sm" style={{ color: '#9898c0' }}>Ready to sign off {qs.name.split(' ')[0]}?</div>
                    </div>
                    <button onClick={() => { setTab('overview'); setSignoffModal({ stageIdx: si, studentId: qs.id }) }}
                      className="text-xs font-bold px-4 py-2.5 rounded-xl flex-shrink-0 active:scale-95 transition-all"
                      style={{ background: 'rgba(46,204,113,0.15)', border: '1px solid rgba(46,204,113,0.4)', color: '#2ecc71' }}>
                      SIGN OFF →
                    </button>
                  </div>
                )}

                {/* Actions */}
                <div className="flex flex-col gap-3 mt-auto pt-2">
                  <button
                    onClick={saveAndNext}
                    disabled={saving === savingKey}
                    className="w-full font-display text-2xl tracking-wide py-5 rounded-2xl active:scale-[0.98] transition-all disabled:opacity-50"
                    style={{ background: saving === savingKey ? 'rgba(255,255,255,0.07)' : '#e8c547', color: saving === savingKey ? '#9898c0' : '#080810', letterSpacing: '0.05em' }}>
                    {saving === savingKey ? 'SAVING…' : queueIdx + 1 >= reviewQueue.length ? 'SAVE & FINISH ✓' : 'SAVE & NEXT →'}
                  </button>
                  <button
                    onClick={skip}
                    className="w-full font-display text-lg tracking-wide py-3.5 rounded-2xl active:scale-[0.98] transition-all"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: '#9898c0', letterSpacing: '0.04em' }}>
                    {queueIdx + 1 >= reviewQueue.length ? 'SKIP & FINISH' : 'SKIP →'}
                  </button>
                </div>
              </div>
            </div>
          )
        })()
      ) : (
        /* ── HOME ── */
        <div className="flex flex-col gap-5 pt-5 pb-10" style={{ maxWidth: 480, margin: '0 auto', padding: '20px 16px 40px' }}>

          {/* Hero */}
          <div className="flex items-start justify-between gap-3 mb-1">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#9898c0' }}>COACH DASHBOARD</div>
              <h1 className="font-display leading-none" style={{ fontSize: 56, letterSpacing: '0.01em', color: '#f0f0eb', lineHeight: 0.88 }}>
                HELLO,<br /><span style={{ color: '#e8c547' }}>{coach.name.split(' ')[0].toUpperCase()}.</span>
              </h1>
              <p className="mt-3 text-sm font-semibold" style={{ color: '#9898c0' }}>
                {totalStudents} student{totalStudents !== 1 ? 's' : ''} · {totalSignoffs} stage{totalSignoffs !== 1 ? 's' : ''} signed off
              </p>
            </div>
            <div className="text-right flex-shrink-0 pt-1">
              <div className="font-display" style={{ fontSize: 30, color: '#f0f0eb', letterSpacing: '0.02em', lineHeight: 1 }}>{time}</div>
              <div className="text-xs font-bold mt-1" style={{ color: '#9898c0' }}>{today.split(',')[0].toUpperCase()}</div>
            </div>
          </div>

          {/* Stat pills */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'STUDENTS', value: totalStudents, color: '#e8c547' },
              { label: 'SIGN-OFFS', value: totalSignoffs, color: '#2ecc71' },
              { label: 'PENDING', value: pendingSignoffs, color: '#ff6b9d' },
            ].map(s => (
              <div key={s.label} className="rounded-2xl px-3 py-4 flex flex-col items-center" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="font-display" style={{ fontSize: 44, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div className="text-[9px] font-bold tracking-widest mt-1.5 text-center uppercase" style={{ color: '#8888b0' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* ② Messages */}
          {(() => {
            const studentsWithMessages = localStudents.filter(s => messages.some(m => m.student_id === s.id && m.from_role === 'student' && !m.read))
            if (studentsWithMessages.length === 0) return null
            return (
              <div>
                <div className="flex items-center gap-2 mb-3" style={{ paddingLeft: 4, borderLeft: '3px solid #ff6b9d' }}>
                  <div className="text-sm font-bold uppercase tracking-widest pl-2" style={{ color: '#f0f0eb' }}>MESSAGES</div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#ff6b9d', color: '#fff' }}>{allUnread.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {studentsWithMessages.map(s => {
                    const lastMsg = messages.filter(m => m.student_id === s.id).slice(-1)[0]
                    const unread = messages.filter(m => m.student_id === s.id && m.from_role === 'student' && !m.read).length
                    return (
                      <button key={s.id} onClick={() => { setSelectedStudentId(s.id); setTab('messages') }}
                        className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl text-left active:scale-[0.98] transition-all"
                        style={{ background: '#111120', border: '1px solid rgba(255,107,157,0.2)', borderLeft: '4px solid #ff6b9d' }}>
                        <div className="w-10 h-10 rounded-full flex items-center justify-center font-display text-base flex-shrink-0"
                          style={{ background: 'rgba(232,197,71,0.12)', border: '1px solid rgba(232,197,71,0.3)', color: '#e8c547' }}>
                          {s.name.trim().split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-base font-bold" style={{ color: '#f0f0eb' }}>{s.name}</div>
                          <div className="text-sm truncate mt-0.5" style={{ color: '#9898c0' }}>{lastMsg?.text}</div>
                        </div>
                        <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0" style={{ background: '#ff6b9d', color: '#fff' }}>{unread}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })()}


          {/* ③ Review CTA — shown when any student has tasks needing review */}
          {(() => {
            const reviewable = localStudents.filter(s =>
              [0,1,2].some(si => { const { done, completed } = countTasks(s.id, si); return completed > done && !getSignoff(s.id, si) })
            )
            if (reviewable.length === 0) return null
            const totalToReview = localStudents.reduce((acc, s) =>
              acc + [0,1,2].reduce((a, si) => { const { done, completed } = countTasks(s.id, si); return a + Math.max(0, completed - done) }, 0), 0)
            return (
              <button
                onClick={() => startReview(reviewable[0].id)}
                className="w-full rounded-2xl active:scale-[0.98] transition-all overflow-hidden"
                style={{ background: 'linear-gradient(135deg, rgba(255,107,157,0.12) 0%, rgba(255,107,157,0.05) 100%)', border: '1px solid rgba(255,107,157,0.35)', boxShadow: '0 0 32px rgba(255,107,157,0.08)' }}
              >
                <div className="px-5 py-5 text-left">
                  <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'rgba(255,107,157,0.7)' }}>
                    {reviewable.length} STUDENT{reviewable.length !== 1 ? 'S' : ''} WAITING
                  </div>
                  <div className="font-display leading-none mb-3" style={{ fontSize: 36, color: '#ff6b9d', letterSpacing: '0.03em' }}>
                    START<br />REVIEW →
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full" style={{ background: 'rgba(255,107,157,0.15)' }}>
                      <div className="h-full rounded-full" style={{ width: '0%', background: '#ff6b9d' }} />
                    </div>
                    <span className="text-xs font-bold" style={{ color: 'rgba(255,107,157,0.7)' }}>{totalToReview} task{totalToReview !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              </button>
            )
          })()}

          {/* ③ Student overview — compact rows */}
          <div>
            <div className="flex items-center gap-2 mb-3" style={{ paddingLeft: 4, borderLeft: '3px solid #e8c547' }}>
              <div className="text-sm font-bold uppercase tracking-widest pl-2" style={{ color: '#f0f0eb' }}>YOUR STUDENTS</div>
            </div>
            {localStudents.length === 0 ? (
              <div className="rounded-2xl px-4 py-8 text-center" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="font-display text-3xl mb-2" style={{ color: 'rgba(255,255,255,0.07)' }}>NO STUDENTS</div>
                <p className="text-sm" style={{ color: '#9898c0' }}>Students link to you by entering your email during sign-up.</p>
                <div className="mt-4 px-5 py-3 rounded-2xl inline-block" style={{ background: '#0c0c18', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: '#7878a8' }}>Your coach email</div>
                  <div className="text-sm font-semibold" style={{ color: '#e8c547' }}>{coach.email}</div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {localStudents.map(s => {
                  const sLastSession = lastSessions.find(x => x.user_id === s.id)
                  const stageStats = [0,1,2].map(si => countTasks(s.id, si))
                  const totalDone = stageStats.reduce((a, x) => a + x.done, 0)
                  const totalAll = stageStats.reduce((a, x) => a + x.total, 0)
                  const overallPct = totalAll ? Math.round(totalDone / totalAll * 100) : 0
                  const toReview = stageStats.reduce((a, x) => a + Math.max(0, x.completed - x.done), 0)
                  const hasReview = toReview > 0 && [0,1,2].some(si => !getSignoff(s.id, si))
                  const initials = s.name.trim().split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase()
                  const unreadMsgs = messages.filter(m => m.student_id === s.id && m.from_role === 'student' && !m.read).length
                  return (
                    <div key={s.id} className="rounded-2xl overflow-hidden" style={{ background: '#111120', border: `1px solid ${hasReview ? 'rgba(255,107,157,0.25)' : 'rgba(255,255,255,0.06)'}` }}>
                      {/* Main row — tap for profile */}
                      <button className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-white/[0.02]" onClick={() => openProfile(s.id)}>
                        <div className="w-10 h-10 rounded-full flex items-center justify-center font-display text-base flex-shrink-0"
                          style={{ background: 'rgba(232,197,71,0.12)', border: '1px solid rgba(232,197,71,0.3)', color: '#e8c547' }}>
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-base leading-none" style={{ color: '#f0f0eb' }}>{s.name}</span>
                            {hasReview && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,107,157,0.15)', color: '#ff6b9d', border: '1px solid rgba(255,107,157,0.3)' }}>{toReview} to review</span>}
                            {unreadMsgs > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: '#ff6b9d', color: '#fff' }}>{unreadMsgs}</span>}
                          </div>
                          <div className="flex items-center gap-2 mt-1.5">
                            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#1a1a2e' }}>
                              <div className="h-full rounded-full transition-all" style={{ width: `${overallPct}%`, background: overallPct === 100 ? '#2ecc71' : '#e8c547' }} />
                            </div>
                            <span className="text-[10px] font-bold flex-shrink-0" style={{ color: '#7878a8' }}>{overallPct}%</span>
                            <span className="text-[10px] flex-shrink-0" style={{ color: '#8888b0' }}>{timeAgo(sLastSession?.started_at)}</span>
                          </div>
                        </div>
                        <span style={{ color: '#3a3a5a', fontSize: 14 }}>›</span>
                      </button>
                      {/* Quick actions */}
                      <div className="flex border-t" style={{ borderColor: '#1a1a2e' }}>
                        <button onClick={() => { setSelectedStudentId(s.id); setTab('messages') }}
                          className="flex-1 py-2.5 text-xs font-bold uppercase tracking-widest active:bg-white/5 transition-all"
                          style={{ color: unreadMsgs > 0 ? '#e8c547' : '#8888b0', borderRight: hasReview ? '1px solid #1a1a2e' : undefined }}>
                          💬 Message{unreadMsgs > 0 ? ` (${unreadMsgs})` : ''}
                        </button>
                        {hasReview && (
                          <button onClick={() => startReview(s.id)}
                            className="flex-1 py-2.5 text-xs font-bold uppercase tracking-widest active:bg-white/5 transition-all"
                            style={{ color: '#ff6b9d' }}>
                            📋 Review ({toReview})
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

        </div>
      )}

      {/* Learner Profile Sheet */}
      {profileSheet && (() => {
        const ps = localStudents.find(s => s.id === profileSheet)!
        const stageStats = [0,1,2].map(si => ({ ...countTasks(profileSheet, si), signed: !!getSignoff(profileSheet, si) }))
        const totalDone = stageStats.reduce((a, s) => a + s.done, 0)
        const totalAll = stageStats.reduce((a, s) => a + s.total, 0)
        return (
          <div className="fixed inset-0 flex items-end justify-center z-50" style={{ background: 'rgba(0,0,0,0.88)' }} onClick={() => { setProfileSheet(null); setEditMode(false) }}>
            <div className="w-full max-w-lg rounded-t-3xl overflow-y-auto" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.07)', maxHeight: '90dvh' }} onClick={e => e.stopPropagation()}>
              <div className="w-10 h-1 rounded-full mx-auto mt-4 mb-2" style={{ background: 'rgba(255,255,255,0.07)' }} />

              {/* Header */}
              <div className="px-6 pt-3 pb-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: '#60608a' }}>LEARNER PROFILE</div>
                    <div className="font-display leading-none" style={{ fontSize: 36, color: '#f0f0eb', letterSpacing: '0.04em' }}>{ps.name.toUpperCase()}</div>
                  </div>
                  <button onClick={() => { if (editMode) { setEditForm({ name: ps.name, location: ps.location ?? '', start_date: ps.start_date ?? '', email: ps.email ?? '' }); setEditMode(false) } else { setEditMode(true) } }}
                    className="px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-widest flex-shrink-0"
                    style={{ background: editMode ? 'rgba(232,197,71,0.15)' : 'rgba(255,255,255,0.05)', border: `1px solid ${editMode ? 'rgba(232,197,71,0.4)' : 'rgba(255,255,255,0.07)'}`, color: editMode ? '#e8c547' : '#9898c0' }}>
                    {editMode ? 'CANCEL' : '✏️ EDIT'}
                  </button>
                </div>
              </div>

              <div className="px-6 py-5 flex flex-col gap-5">
                {editMode ? (
                  /* Edit form */
                  <div className="flex flex-col gap-4">
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#7878a8' }}>Full name</label>
                      <input className="inp" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} style={{ fontSize: 16 }} />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#7878a8' }}>Location / Club</label>
                      <input className="inp" value={editForm.location} onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))} placeholder="Studio or club name" style={{ fontSize: 16 }} />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#7878a8' }}>Start date</label>
                      <input type="date" className="inp" value={editForm.start_date} onChange={e => setEditForm(f => ({ ...f, start_date: e.target.value }))} style={{ fontSize: 16 }} />
                    </div>
                    <div>
                      <label className="block text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#7878a8' }}>Email (read only)</label>
                      <input className="inp" value={editForm.email} disabled style={{ fontSize: 16, opacity: 0.4 }} />
                    </div>
                    <button onClick={saveEdit} disabled={editSaving}
                      className="font-display tracking-widest py-4 rounded-2xl transition-all disabled:opacity-40 active:scale-[0.98]"
                      style={{ fontSize: 22, background: '#e8c547', color: '#080810', letterSpacing: '0.06em' }}>
                      {editSaving ? 'SAVING…' : 'SAVE CHANGES →'}
                    </button>
                  </div>
                ) : (
                  /* Info view */
                  <>
                    {/* Key details */}
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { label: 'EMAIL', value: ps.email ?? '—', color: '#f0f0eb' },
                        { label: 'LOCATION', value: ps.location ?? '—', color: '#f0f0eb' },
                        { label: 'STARTED', value: formatDate(ps.start_date), color: '#e8c547' },
                        { label: 'LAST ACTIVE', value: timeAgo(lastSessions.find(s => s.user_id === profileSheet)?.started_at), color: '#4ecdc4' },
                      ].map(item => (
                        <div key={item.label} className="rounded-2xl p-4" style={{ background: '#0c0c18', border: '1px solid rgba(255,255,255,0.05)' }}>
                          <div className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: '#60608a' }}>{item.label}</div>
                          <div className="text-sm font-semibold leading-snug" style={{ color: item.color }}>{item.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Overall progress */}
                    <div>
                      <div className="text-sm font-bold uppercase tracking-widest mb-3" style={{ color: '#9898c0' }}>TRAINING PROGRESS — {totalAll ? Math.round(totalDone / totalAll * 100) : 0}% OVERALL</div>
                      {stageStats.map((s, si) => {
                        const signoff = getSignoff(profileSheet, si)
                        const unlocked = si === 0 || !!getSignoff(profileSheet, si - 1)
                        const stageComplete = s.done === s.total && s.total > 0
                        const { completed } = countTasks(profileSheet, si)
                        const hasReview = completed > s.done && !s.signed
                        return (
                          <div key={si} className="py-3 flex flex-col gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                            <div className="flex items-center gap-3">
                              <div className="font-display text-xl flex-shrink-0 w-8 text-center" style={{ color: colours[si] }}>S{si + 1}</div>
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between text-sm font-semibold mb-1.5" style={{ color: '#9898c0' }}>
                                  <span className="truncate mr-2">{stageNames[si]}</span>
                                  <span style={{ color: hasReview ? '#ff6b9d' : colours[si], flexShrink: 0 }}>
                                    {s.done}/{s.total}{hasReview ? ` · ${completed - s.done} to review` : ''}
                                  </span>
                                </div>
                                <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1a1a2e' }}>
                                  <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: s.signed ? '#2ecc71' : colours[si] }} />
                                </div>
                              </div>
                              {s.signed ? (
                                <span className="text-xs font-bold px-2 py-1 rounded-lg flex-shrink-0" style={{ background: 'rgba(46,204,113,0.1)', color: '#2ecc71', border: '1px solid rgba(46,204,113,0.25)' }}>✓ SIGNED</span>
                              ) : unlocked && stageComplete ? (
                                <button onClick={() => { setProfileSheet(null); setSignoffModal({ stageIdx: si, studentId: profileSheet }) }}
                                  className="text-xs font-bold px-2 py-1.5 rounded-lg flex-shrink-0 active:scale-95 transition-all"
                                  style={{ background: 'rgba(232,197,71,0.12)', border: '1px solid rgba(232,197,71,0.4)', color: '#e8c547' }}>
                                  SIGN OFF
                                </button>
                              ) : (
                                <span className="text-xs font-bold px-2 py-1 rounded-lg flex-shrink-0" style={{ color: '#8888b0', border: '1px solid #1a1a2e' }}>
                                  {unlocked ? 'IN PROGRESS' : 'LOCKED'}
                                </span>
                              )}
                            </div>
                            {s.signed && signoff && (
                              <div className="flex flex-col gap-1.5 pl-11">
                                <div className="text-xs font-semibold" style={{ color: '#8888b0' }}>
                                  Signed {formatDate(signoff.signed_at ?? null)}
                                </div>
                                <button onClick={() => revokeSignoff(profileSheet, si)}
                                  className="self-start text-xs font-bold px-3 py-1.5 rounded-lg active:scale-95 transition-all"
                                  style={{ color: '#ff6b9d', border: '1px solid rgba(255,107,157,0.25)', background: 'rgba(255,107,157,0.06)' }}>
                                  UNDO SIGN-OFF
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* Quick actions */}
                    {(() => {
                      const profileToReview = [0,1,2].some(si => { const { done, completed } = countTasks(profileSheet, si); return completed > done && !getSignoff(profileSheet, si) })
                      return (
                        <div className="flex gap-3 pb-2">
                          <button onClick={() => { setProfileSheet(null); setSelectedStudentId(profileSheet); setTab('messages') }}
                            className="flex-1 py-4 rounded-2xl font-display text-xl tracking-wide active:scale-[0.98] transition-all"
                            style={{ background: 'rgba(232,197,71,0.08)', border: '1px solid rgba(232,197,71,0.3)', color: '#e8c547', letterSpacing: '0.06em' }}>
                            💬 MESSAGE
                          </button>
                          {profileToReview && (
                            <button onClick={() => { setProfileSheet(null); startReview(profileSheet) }}
                              className="flex-1 py-4 rounded-2xl font-display text-xl tracking-wide active:scale-[0.98] transition-all"
                              style={{ background: 'rgba(255,107,157,0.08)', border: '1px solid rgba(255,107,157,0.3)', color: '#ff6b9d', letterSpacing: '0.06em' }}>
                              📋 REVIEW
                            </button>
                          )}
                        </div>
                      )
                    })()}
                  </>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Sign-off modal */}
      {signoffModal && (
        <div className="fixed inset-0 flex items-end justify-center z-50 p-0" style={{ background: 'rgba(0,0,0,0.88)' }} onClick={() => { setSignoffModal(null); setSignoffNote('') }}>
          <div className="w-full max-w-lg rounded-t-3xl p-6 pb-10" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.07)' }} onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full mx-auto mb-6" style={{ background: 'rgba(255,255,255,0.07)' }} />
            <div className="font-display tracking-wide mb-1" style={{ fontSize: 36, color: '#e8c547', letterSpacing: '0.06em' }}>SIGN OFF</div>
            <div className="font-display text-2xl mb-5" style={{ color: colours[signoffModal.stageIdx] }}>
              STAGE {signoffModal.stageIdx + 1} — {stageNames[signoffModal.stageIdx].toUpperCase()}
            </div>
            <textarea className="inp mb-4" placeholder="Your overall note for this stage (optional)…" value={signoffNote} onChange={e => setSignoffNote(e.target.value)} style={{ minHeight: 100, fontSize: 15 }} />
            <div className="flex gap-3">
              <button onClick={() => { setSignoffModal(null); setSignoffNote('') }}
                className="flex-1 py-4 rounded-2xl text-sm font-bold uppercase tracking-widest"
                style={{ border: '1px solid rgba(255,255,255,0.07)', color: '#9898c0', background: 'none' }}>Cancel</button>
              <button onClick={confirmSignoff}
                className="flex-[2] py-4 rounded-2xl font-display text-2xl tracking-wide active:scale-[0.98] transition-all"
                style={{ background: '#2ecc71', color: '#0a0a12', letterSpacing: '0.06em' }}>
                SIGN OFF ✓
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
