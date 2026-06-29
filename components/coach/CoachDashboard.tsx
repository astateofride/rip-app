'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { STAGES } from '@/lib/stages'
import type { Profile, TaskProgress, DayData, CoachRemark, StageSignoff, Message, SessionLog, CoachNote } from '@/lib/types'

interface Props {
  coach: Profile
  students: Profile[]
  pendingStudents: Profile[]
  allCoaches: Profile[]
  allTasks: TaskProgress[]
  allDayData: DayData[]
  allRemarks: CoachRemark[]
  allSignoffs: StageSignoff[]
  allMessages: Message[]
  lastSessions: SessionLog[]
  coachNotes: CoachNote[]
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

const colours = ['#e8c547', '#4ecdc4', '#c0bfe0']
const stageNames = ['Mastering Music', 'Magic in Movement', 'Finding Your Voice']

export default function CoachDashboard({ coach, students, pendingStudents, allCoaches, allTasks, allDayData, allRemarks, allSignoffs, allMessages, lastSessions, coachNotes: initialNotes, coachId }: Props) {
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
  const [localTasks, setLocalTasks] = useState<TaskProgress[]>(allTasks)
  const [reviewQueue, setReviewQueue] = useState<QueueItem[]>([])
  const [queueIdx, setQueueIdx] = useState(0)
  const [queueNote, setQueueNote] = useState('')
  const [studentReviewSheet, setStudentReviewSheet] = useState<string | null>(null)
  const [sheetNotes, setSheetNotes] = useState<Record<string, string>>({})
  const [newStudentToast, setNewStudentToast] = useState<string | null>(null)
  const [localPending, setLocalPending] = useState<Profile[]>(pendingStudents)
  const [localNotes, setLocalNotes] = useState<CoachNote[]>(initialNotes)
  const [noteText, setNoteText] = useState('')
  const [noteMode, setNoteMode] = useState<'general' | 'student_file' | 'coach_flag' | null>(null)
  const [noteStudentId, setNoteStudentId] = useState<string>('')
  const [noteFlaggedCoachId, setNoteFlaggedCoachId] = useState<string>('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [showAccountMenu, setShowAccountMenu] = useState(false)
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
    const channel = supabase.channel('coach-new-students')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles', filter: `role=eq.student` },
        payload => {
          const p = payload.new as Profile
          setNewStudentToast(p.name || 'A new student')
          setLocalPending(prev => prev.some(x => x.id === p.id) ? prev : [...prev, p])
          setTimeout(() => setNewStudentToast(null), 6000)
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [])

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
    const stageTasks = localTasks.filter(t => t.student_id === studentId && t.stage_idx === si)
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

  async function saveAllSheetNotes(studentId: string) {
    const entries = Object.entries(sheetNotes).filter(([, v]) => v.trim())
    for (const [key, remark] of entries) {
      const [siStr, diStr] = key.split('-')
      await saveRemark(studentId, Number(siStr), Number(diStr), remark)
    }
    setStudentReviewSheet(null)
    setSheetNotes({})
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

  async function coachMarkTaskDone(studentId: string, si: number, di: number, ti: number) {
    // Optimistic update — remove from incomplete list immediately
    setLocalTasks(prev => {
      const existing = prev.find(t => t.student_id === studentId && t.stage_idx === si && t.day_idx === di && t.task_idx === ti)
      if (existing) return prev.map(t => t === existing ? { ...t, completed: true, completed_at: new Date().toISOString() } : t)
      return [...prev, { id: `coach-${studentId}-${si}-${di}-${ti}`, student_id: studentId, stage_idx: si, day_idx: di, task_idx: ti, completed: true, completed_at: new Date().toISOString(), answer: null, score: null }]
    })
    await supabase.from('task_progress').upsert(
      { student_id: studentId, stage_idx: si, day_idx: di, task_idx: ti, completed: true, completed_at: new Date().toISOString() },
      { onConflict: 'student_id,stage_idx,day_idx,task_idx' }
    )
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

  async function acceptStudent(studentId: string) {
    await supabase.from('profiles').update({ pending: false, coach_id: coachId }).eq('id', studentId)
    setLocalPending(prev => prev.filter(p => p.id !== studentId))
    const accepted = localPending.find(p => p.id === studentId)
    if (accepted) setLocalStudents(prev => [...prev, accepted])
    router.refresh()
  }

  async function saveNote() {
    if (!noteText.trim() || !noteMode) return
    setNoteSaving(true)
    const payload: Partial<CoachNote> = {
      coach_id: coachId,
      text: noteText.trim(),
      type: noteMode,
      student_id: noteMode === 'student_file' ? noteStudentId || null : null,
      flagged_coach_id: noteMode === 'coach_flag' ? noteFlaggedCoachId || null : null,
    }
    const { data } = await supabase.from('coach_notes').insert(payload).select().single()
    if (data) setLocalNotes(prev => [data as CoachNote, ...prev])
    setNoteText('')
    setNoteMode(null)
    setNoteStudentId('')
    setNoteFlaggedCoachId('')
    setNoteSaving(false)
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
          const hasDone = localTasks.some(t => t.student_id === student.id && t.stage_idx === si && t.day_idx === di && t.completed)
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
  const stagesToSignOff = localStudents.reduce((acc, s) =>
    acc + [0,1,2].filter(si => {
      const { done, total } = countTasks(s.id, si)
      return done === total && total > 0 && !getSignoff(s.id, si)
    }).length, 0)
  const totalPendingTasks = localStudents.reduce((acc, s) =>
    acc + [0,1,2].reduce((a, si) => {
      const { completed, done } = countTasks(s.id, si)
      return a + Math.max(0, completed - done)
    }, 0), 0)

  // Response time rating: avg hours between task completed_at and remark updated_at, capped at 36h
  const MAX_HOURS = 36
  const responseTimes: number[] = []
  for (const s of localStudents) {
    for (let si = 0; si < 3; si++) {
      for (let di = 0; di < STAGES[si].days.length; di++) {
        const remark = remarks.find(r => r.student_id === s.id && r.stage_idx === si && r.day_idx === di)
        if (!remark) continue
        const dayTasks = localTasks.filter(t => t.student_id === s.id && t.stage_idx === si && t.day_idx === di && t.completed && t.completed_at)
        if (dayTasks.length === 0) continue
        const lastSubmit = Math.max(...dayTasks.map(t => new Date(t.completed_at!).getTime()))
        const reviewedAt = new Date(remark.updated_at).getTime()
        const hours = (reviewedAt - lastSubmit) / 3600000
        if (hours >= 0) responseTimes.push(Math.min(hours, MAX_HOURS))
      }
    }
  }
  const avgResponseHours = responseTimes.length > 0 ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : null
  const responseRating = avgResponseHours !== null ? Math.round((1 - avgResponseHours / MAX_HOURS) * 100) : null

  return (
    <div style={{ background: '#080810', minHeight: '100vh', paddingBottom: 80 }}>

      {/* New student toast */}
      {newStudentToast && (
        <div className="fixed top-4 left-1/2 z-[500] -translate-x-1/2 px-5 py-3 rounded-2xl shadow-xl flex items-center gap-3 animate-fade-in"
          style={{ background: '#111120', border: '1px solid rgba(78,205,196,0.4)', minWidth: 260, maxWidth: 'calc(100vw - 32px)' }}>
          <span className="text-xl flex-shrink-0">🎉</span>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: '#4ecdc4' }}>New Student Joined</div>
            <div className="text-sm font-semibold truncate" style={{ color: '#f0f0eb' }}>{newStudentToast} has signed up</div>
          </div>
          <button onClick={() => setNewStudentToast(null)} className="text-sm flex-shrink-0" style={{ color: '#7878a8' }}>✕</button>
        </div>
      )}

      {/* Topbar */}
      <div className="sticky top-0 z-50" style={{ background: '#080810', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center justify-between px-4 gap-3" style={{ height: 60 }}>
          {/* Left: avatar + brand */}
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setShowAccountMenu(true)}
              className="w-9 h-9 rounded-full flex items-center justify-center font-display flex-shrink-0"
              style={{ background: 'rgba(232,197,71,0.12)', border: '1px solid rgba(232,197,71,0.45)', color: '#e8c547', fontSize: 16 }}>
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
        </div>
      </div>

      {/* Account menu */}
      {showAccountMenu && (
        <div className="fixed inset-0 z-[400] flex items-end" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setShowAccountMenu(false)}>
          <div className="w-full rounded-t-3xl pb-8" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.08)' }} onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full mx-auto mt-4 mb-5" style={{ background: 'rgba(255,255,255,0.1)' }} />
            <div className="px-5 flex flex-col items-center">
              <div className="w-14 h-14 rounded-full flex items-center justify-center font-display mb-2" style={{ background: 'rgba(232,197,71,0.12)', border: '1px solid rgba(232,197,71,0.45)', color: '#e8c547', fontSize: 22 }}>{coachInitials}</div>
              <div className="font-bold text-sm mb-0.5 text-center" style={{ color: '#f0f0eb' }}>{coach.name}</div>
              <div className="text-xs mb-5 text-center" style={{ color: '#7878a8' }}>Coach</div>
              <a
                href="/coach/preview"
                className="w-full py-4 rounded-2xl font-bold text-sm uppercase tracking-widest active:scale-[0.98] transition-all flex items-center justify-center gap-2 mb-3"
                style={{ background: 'rgba(232,197,71,0.08)', border: '1px solid rgba(232,197,71,0.25)', color: '#e8c547', textDecoration: 'none' }}
              >
                👁 Student Preview
              </a>
              <button
                onClick={signOut}
                className="w-full py-4 rounded-2xl font-bold text-sm uppercase tracking-widest active:scale-[0.98] transition-all"
                style={{ background: 'rgba(255,107,157,0.08)', border: '1px solid rgba(255,107,157,0.25)', color: '#ff6b9d' }}
              >
                Sign Out
              </button>
              <p className="text-[10px] uppercase tracking-widest mt-3" style={{ color: '#3a3a5a' }}>
                BETA · {process.env.NEXT_PUBLIC_GIT_HASH ?? 'dev'}
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === 'messages' && student ? (
        /* ── MESSAGES FULL SCREEN ── */
        <div className="flex flex-col" style={{ height: 'calc(100dvh - 60px)', position: 'fixed', top: 60, left: 0, right: 0, bottom: 0, zIndex: 40, background: '#080810' }}>
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
          const completedTasks = localTasks.filter(t => t.student_id === qs.id && t.stage_idx === si && t.day_idx === di && t.completed)
          const incompleteTasks = day.tasks.map((task, ti) => ({ task, ti })).filter(({ ti }) => !localTasks.find(t => t.student_id === qs.id && t.stage_idx === si && t.day_idx === di && t.task_idx === ti && t.completed))
          const writtenAnswers = day.tasks.map((task, ti) => {
            const prog = localTasks.find(t => t.student_id === qs.id && t.stage_idx === si && t.day_idx === di && t.task_idx === ti)
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

                {/* Day title card */}
                <div className="rounded-2xl px-4 py-4" style={{ background: '#111120', borderLeft: `4px solid ${colour}`, border: `1px solid rgba(255,255,255,0.06)`, borderLeftWidth: 4, borderLeftColor: colour }}>
                  <div className="font-display text-2xl leading-tight mb-2" style={{ color: colour, letterSpacing: '0.04em' }}>{day.title}</div>
                  <div className="flex flex-wrap gap-2">
                    <span className="text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-widest" style={{ background: 'rgba(255,255,255,0.06)', color: '#9898c0' }}>
                      {completedTasks.length}/{day.tasks.length} tasks done
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-widest`}
                      style={dayDataRow?.manual_read_at
                        ? { background: 'rgba(78,205,196,0.12)', color: '#4ecdc4', border: '1px solid rgba(78,205,196,0.3)' }
                        : { background: 'rgba(255,255,255,0.04)', color: '#5a5a7a', border: '1px solid rgba(255,255,255,0.06)' }}>
                      📖 {dayDataRow?.manual_read_at ? 'Manual read ✓' : 'Manual NOT read'}
                    </span>
                    {existingRemark && (
                      <span className="text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-widest" style={{ background: 'rgba(46,204,113,0.1)', color: '#2ecc71', border: '1px solid rgba(46,204,113,0.25)' }}>
                        ✓ Note saved
                      </span>
                    )}
                  </div>
                </div>

                {/* Written answers — main content */}
                {writtenAnswers.length > 0 ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-2" style={{ paddingLeft: 4, borderLeft: '3px solid #e8c547' }}>
                      <div className="text-sm font-bold uppercase tracking-widest pl-2" style={{ color: '#f0f0eb' }}>Written Answers</div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(232,197,71,0.15)', color: '#e8c547' }}>{writtenAnswers.length}</span>
                    </div>
                    {writtenAnswers.map(item => {
                      if (!item) return null
                      const { ti, task, prog, needsWork } = item
                      return (
                        <div key={ti} className="rounded-2xl overflow-hidden" style={{ background: '#0c0c18', border: `1px solid ${needsWork ? 'rgba(255,107,157,0.35)' : 'rgba(46,204,113,0.25)'}` }}>
                          {/* Question */}
                          <div className="px-4 pt-3 pb-2" style={{ borderBottom: `1px solid ${needsWork ? 'rgba(255,107,157,0.12)' : 'rgba(46,204,113,0.1)'}` }}>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8888b0' }}>Task {ti + 1} — Question</span>
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={needsWork
                                ? { background: 'rgba(255,107,157,0.15)', color: '#ff6b9d', border: '1px solid rgba(255,107,157,0.3)' }
                                : { background: 'rgba(46,204,113,0.12)', color: '#2ecc71', border: '1px solid rgba(46,204,113,0.3)' }}>
                                {prog.score ?? 0}% {needsWork ? '· needs work' : '· passed'}
                              </span>
                            </div>
                            <p className="text-sm leading-snug font-medium" style={{ color: '#c0c0d8' }}>{task.text}</p>
                          </div>
                          {/* Answer */}
                          <div className="px-4 py-3">
                            <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: needsWork ? '#ff6b9d' : '#2ecc71' }}>Student's Answer</div>
                            <p className="text-base leading-relaxed" style={{ color: '#f0f0eb' }}>{prog.answer}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl px-4 py-3 text-sm" style={{ background: '#0c0c18', border: '1px solid rgba(255,255,255,0.05)', color: '#5a5a7a' }}>
                    No written answers for this day
                  </div>
                )}

                {/* Video submission */}
                {dayDataRow?.video_url && (
                  <div className="rounded-xl px-4 py-3" style={{ background: '#0c0c18', border: '1px solid rgba(78,205,196,0.25)' }}>
                    <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#4ecdc4' }}>▶ VIDEO SUBMISSION</div>
                    <a href={dayDataRow.video_url} target="_blank" rel="noopener noreferrer"
                      className="text-sm font-semibold underline truncate block" style={{ color: '#4ecdc4' }}>{dayDataRow.video_url}</a>
                  </div>
                )}

                {/* Student reflection */}
                {dayDataRow?.reflection && (
                  <div className="rounded-xl px-4 py-3" style={{ background: '#0c0c18', borderLeft: '3px solid rgba(255,255,255,0.15)' }}>
                    <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#9898c0' }}>STUDENT REFLECTION</div>
                    <p className="text-sm italic leading-relaxed" style={{ color: '#d4d4ea' }}>{dayDataRow.reflection}</p>
                  </div>
                )}

                {/* Incomplete tasks still to do */}
                {incompleteTasks.length > 0 && (
                  <div>
                    <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#8888b0' }}>Still to complete — tap to mark done</div>
                    <div className="flex flex-col gap-1.5">
                      {incompleteTasks.map(({ task, ti }) => (
                        <button key={ti} onClick={() => coachMarkTaskDone(qs.id, si, di, ti)}
                          className="flex items-start gap-3 px-3 py-2.5 rounded-xl w-full text-left active:scale-[0.98] transition-all"
                          style={{ background: '#0c0c18', border: '1px solid #1a1a2e' }}>
                          <div className="w-5 h-5 rounded-full border flex-shrink-0 mt-0.5" style={{ borderColor: '#3a3a5a' }} />
                          <p className="text-sm leading-snug" style={{ color: '#9898c0' }}>{task.text}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sign off prompt */}
                {stageComplete && (
                  <div className="rounded-2xl px-4 py-4 flex items-center justify-between gap-3" style={{ background: 'rgba(46,204,113,0.07)', border: '1px solid rgba(46,204,113,0.3)' }}>
                    <div>
                      <div className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: '#2ecc71' }}>Stage {si + 1} complete!</div>
                      <div className="text-sm" style={{ color: '#c0c0d8' }}>Ready to sign off {qs.name.split(' ')[0]}?</div>
                    </div>
                    <button onClick={() => { setTab('overview'); setSignoffModal({ stageIdx: si, studentId: qs.id }) }}
                      className="text-sm font-bold px-4 py-3 rounded-xl flex-shrink-0 active:scale-95 transition-all"
                      style={{ background: 'rgba(46,204,113,0.15)', border: '1px solid rgba(46,204,113,0.4)', color: '#2ecc71' }}>
                      SIGN OFF →
                    </button>
                  </div>
                )}

                {/* Coach note */}
                <div>
                  <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: existingRemark ? '#2ecc71' : '#9898c0' }}>
                    {existingRemark ? '✓ Your note (tap to edit)' : 'Leave a coaching note'}
                  </div>
                  <textarea
                    className="inp"
                    value={queueNote}
                    onChange={e => setQueueNote(e.target.value)}
                    placeholder="Feedback for this day…"
                    style={{ minHeight: 80, fontSize: 15 }}
                  />
                </div>

                {/* Sticky action buttons */}
                <div className="flex flex-col gap-3 pb-2">
                  <button
                    onClick={saveAndNext}
                    disabled={saving === savingKey}
                    className="w-full font-display text-2xl tracking-wide py-5 rounded-2xl active:scale-[0.98] transition-all disabled:opacity-50"
                    style={{ background: saving === savingKey ? 'rgba(255,255,255,0.07)' : '#e8c547', color: saving === savingKey ? '#9898c0' : '#080810', letterSpacing: '0.05em' }}>
                    {saving === savingKey ? 'SAVING…' : queueIdx + 1 >= reviewQueue.length ? 'SAVE & FINISH ✓' : 'SAVE & NEXT →'}
                  </button>
                  <button
                    onClick={skip}
                    className="w-full font-display text-lg tracking-wide py-4 rounded-2xl active:scale-[0.98] transition-all"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: '#9898c0', letterSpacing: '0.04em' }}>
                    {queueIdx + 1 >= reviewQueue.length ? 'SKIP & FINISH' : 'SKIP — COME BACK LATER'}
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
                {(() => { const h = new Date().getHours(); return h < 12 ? 'GOOD MORNING,' : h < 17 ? 'GOOD AFTERNOON,' : 'GOOD EVENING,' })()}<br /><span style={{ color: '#e8c547' }}>{coach.name.split(' ')[0].toUpperCase()}.</span>
              </h1>
              <p className="mt-3 text-sm font-semibold" style={{ color: '#9898c0' }}>
                {totalStudents} student{totalStudents !== 1 ? 's' : ''} · {stagesToSignOff > 0 ? `${stagesToSignOff} ready to sign off` : 'all stages up to date'}
              </p>
            </div>
            <div className="text-right flex-shrink-0 pt-1">
              <div className="font-display" style={{ fontSize: 30, color: '#f0f0eb', letterSpacing: '0.02em', lineHeight: 1 }}>{time}</div>
              <div className="text-xs font-bold mt-1" style={{ color: '#9898c0' }}>{today.split(',')[0].toUpperCase()}</div>
              <span className="inline-block mt-2 text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full" style={{ background: '#e8c547', color: '#080810' }}>COACH</span>
            </div>
          </div>

          {/* Stat pills */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'STUDENTS', value: totalStudents, color: '#e8c547' },
              { label: 'SIGN OFF', value: stagesToSignOff, color: '#4ecdc4' },
              { label: 'PENDING', value: totalPendingTasks, color: '#e8c547' },
            ].map(s => (
              <div key={s.label} className="rounded-2xl px-3 py-4 flex flex-col items-center" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="font-display" style={{ fontSize: 44, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div className="text-[9px] font-bold tracking-widest mt-1.5 text-center uppercase" style={{ color: '#8888b0' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* ② Response time rating */}
          {responseRating !== null && (
            <div className="rounded-2xl px-4 py-4" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8888b0' }}>ASSESSMENT RESPONSE SPEED</div>
                <div className="font-display text-xl" style={{ color: responseRating >= 75 ? '#2ecc71' : responseRating >= 40 ? '#e8c547' : '#ff6b9d', lineHeight: 1 }}>{responseRating}%</div>
              </div>
              <div className="relative h-2 rounded-full overflow-hidden mb-2" style={{ background: '#1a1a2e' }}>
                <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
                  style={{ width: `${responseRating}%`, background: responseRating >= 75 ? '#2ecc71' : responseRating >= 40 ? '#e8c547' : '#ff6b9d' }} />
              </div>
              <div className="flex justify-between text-[9px] uppercase tracking-widest" style={{ color: '#60608a' }}>
                <span>Slowest · 36h</span>
                <span>{avgResponseHours !== null ? `avg ${avgResponseHours < 1 ? `${Math.round(avgResponseHours * 60)}m` : `${avgResponseHours.toFixed(1)}h`}` : ''}</span>
                <span>Fastest · 0m</span>
              </div>
            </div>
          )}

          {/* ③ Messages — always shown */}
          <div>
            <div className="flex items-center gap-2 mb-3" style={{ paddingLeft: 4, borderLeft: '3px solid #e8c547' }}>
              <div className="text-sm font-bold uppercase tracking-widest pl-2" style={{ color: '#f0f0eb' }}>MESSAGES</div>
              {allUnread.length > 0 && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#e8c547', color: '#080810' }}>{allUnread.length}</span>}
            </div>
            {allUnread.length === 0 ? (
              <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.06)', color: '#7878a8' }}>
                No new messages
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {localStudents.filter(s => messages.some(m => m.student_id === s.id && m.from_role === 'student' && !m.read)).map(s => {
                  const unreadMsgs = messages.filter(m => m.student_id === s.id && m.from_role === 'student' && !m.read)
                  const lastUnread = unreadMsgs.slice(-1)[0]
                  const initials = s.name.trim().split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase()
                  return (
                    <button key={s.id} onClick={() => { setSelectedStudentId(s.id); setTab('messages') }}
                      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left active:scale-[0.98] transition-all"
                      style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <div className="w-10 h-10 rounded-full flex items-center justify-center font-display text-base flex-shrink-0"
                        style={{ background: 'rgba(232,197,71,0.12)', border: '1px solid rgba(232,197,71,0.3)', color: '#e8c547' }}>
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-base font-bold" style={{ color: '#f0f0eb' }}>{s.name}</div>
                        <div className="text-sm truncate mt-0.5" style={{ color: '#9898c0' }}>{lastUnread.text}</div>
                      </div>
                      <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0" style={{ background: '#e8c547', color: '#080810' }}>{unreadMsgs.length}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>


          {/* ③ Coach Notes */}
          <div>
            <div className="flex items-center gap-2 mb-3" style={{ paddingLeft: 4, borderLeft: '3px solid #9898c0' }}>
              <div className="text-sm font-bold uppercase tracking-widest pl-2" style={{ color: '#f0f0eb' }}>NOTES</div>
            </div>

            {/* Write a note */}
            <div className="rounded-2xl overflow-hidden mb-3" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.07)' }}>
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="Write a note…"
                rows={3}
                className="w-full px-4 pt-3 pb-2 text-sm resize-none bg-transparent outline-none"
                style={{ color: '#f0f0eb', borderBottom: noteText ? '1px solid rgba(255,255,255,0.07)' : 'none' }}
              />
              {noteText.trim() && (
                <div className="px-3 pb-3 pt-2 flex flex-col gap-2">
                  {/* Mode picker */}
                  <div className="flex gap-2">
                    <button onClick={() => setNoteMode(noteMode === 'general' ? null : 'general')}
                      className="flex-1 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all"
                      style={{ background: noteMode === 'general' ? 'rgba(152,152,192,0.2)' : 'rgba(255,255,255,0.04)', border: `1px solid ${noteMode === 'general' ? 'rgba(152,152,192,0.5)' : 'rgba(255,255,255,0.07)'}`, color: noteMode === 'general' ? '#c0c0e0' : '#7878a8' }}>
                      General
                    </button>
                    <button onClick={() => setNoteMode(noteMode === 'student_file' ? null : 'student_file')}
                      className="flex-1 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all"
                      style={{ background: noteMode === 'student_file' ? 'rgba(232,197,71,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${noteMode === 'student_file' ? 'rgba(232,197,71,0.4)' : 'rgba(255,255,255,0.07)'}`, color: noteMode === 'student_file' ? '#e8c547' : '#7878a8' }}>
                      Student File
                    </button>
                    <button onClick={() => setNoteMode(noteMode === 'coach_flag' ? null : 'coach_flag')}
                      className="flex-1 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all"
                      style={{ background: noteMode === 'coach_flag' ? 'rgba(255,107,157,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${noteMode === 'coach_flag' ? 'rgba(255,107,157,0.4)' : 'rgba(255,255,255,0.07)'}`, color: noteMode === 'coach_flag' ? '#ff6b9d' : '#7878a8' }}>
                      Flag Coach
                    </button>
                  </div>

                  {/* Student picker */}
                  {noteMode === 'student_file' && (
                    <select value={noteStudentId} onChange={e => setNoteStudentId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-sm"
                      style={{ background: '#0c0c18', border: '1px solid rgba(232,197,71,0.3)', color: noteStudentId ? '#f0f0eb' : '#7878a8' }}>
                      <option value="">Select student…</option>
                      {localStudents.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  )}

                  {/* Coach picker */}
                  {noteMode === 'coach_flag' && (
                    <select value={noteFlaggedCoachId} onChange={e => setNoteFlaggedCoachId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-sm"
                      style={{ background: '#0c0c18', border: '1px solid rgba(255,107,157,0.3)', color: noteFlaggedCoachId ? '#f0f0eb' : '#7878a8' }}>
                      <option value="">Select coach…</option>
                      {allCoaches.filter(c => c.id !== coachId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}

                  {/* Save */}
                  {noteMode && (
                    <button onClick={saveNote} disabled={noteSaving || (noteMode === 'student_file' && !noteStudentId) || (noteMode === 'coach_flag' && !noteFlaggedCoachId)}
                      className="w-full py-2.5 rounded-xl font-display tracking-widest text-sm uppercase active:scale-[0.98] transition-all disabled:opacity-40"
                      style={{ background: noteMode === 'coach_flag' ? '#ff6b9d' : noteMode === 'student_file' ? '#e8c547' : '#9898c0', color: '#080810' }}>
                      {noteSaving ? 'Saving…' : 'Save Note'}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Existing notes */}
            {localNotes.length === 0 ? (
              <div className="rounded-2xl px-4 py-3 text-sm" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.06)', color: '#7878a8' }}>
                No notes yet
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {localNotes.map(n => {
                  const tagColour = n.type === 'student_file' ? '#e8c547' : n.type === 'coach_flag' ? '#ff6b9d' : '#9898c0'
                  const tagLabel = n.type === 'student_file' ? `Student File${n.student_id ? ' — ' + (localStudents.find(s => s.id === n.student_id)?.name ?? '') : ''}` : n.type === 'coach_flag' ? `Flagged${n.flagged_coach_id ? ' — ' + (allCoaches.find(c => c.id === n.flagged_coach_id)?.name ?? '') : ''}` : 'General'
                  return (
                    <div key={n.id} className="rounded-2xl px-4 py-3" style={{ background: '#111120', border: `1px solid rgba(255,255,255,0.06)`, borderLeft: `3px solid ${tagColour}` }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: tagColour }}>{tagLabel}</span>
                        <span className="text-[10px]" style={{ color: '#7878a8' }}>{new Date(n.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
                      </div>
                      <p className="text-sm leading-relaxed" style={{ color: '#c0c0d8' }}>{n.text}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ④ Review CTA — shown when any student has tasks needing review */}
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
                style={{ background: 'linear-gradient(135deg, rgba(232,197,71,0.12) 0%, rgba(232,197,71,0.05) 100%)', border: '1px solid rgba(232,197,71,0.4)', boxShadow: '0 0 32px rgba(232,197,71,0.1)' }}
              >
                <div className="px-5 py-5 text-left">
                  <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: 'rgba(232,197,71,0.7)' }}>
                    {reviewable.length} STUDENT{reviewable.length !== 1 ? 'S' : ''} WAITING
                  </div>
                  <div className="font-display leading-none mb-3" style={{ fontSize: 36, color: '#e8c547', letterSpacing: '0.03em' }}>
                    START<br />REVIEW →
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full" style={{ background: 'rgba(232,197,71,0.15)' }}>
                      <div className="h-full rounded-full" style={{ width: '0%', background: '#e8c547' }} />
                    </div>
                    <span className="text-xs font-bold" style={{ color: 'rgba(232,197,71,0.8)' }}>{totalToReview} task{totalToReview !== 1 ? 's' : ''}</span>
                  </div>
                </div>
              </button>
            )
          })()}

          {/* Pending students banner */}
          {localPending.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-3" style={{ paddingLeft: 4, borderLeft: '3px solid #4ecdc4' }}>
                <div className="text-sm font-bold uppercase tracking-widest pl-2" style={{ color: '#4ecdc4' }}>UNALLOCATED STUDENTS</div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#4ecdc4', color: '#080810' }}>{localPending.length}</span>
              </div>
              <div className="flex flex-col gap-2">
                {localPending.map(p => (
                  <div key={p.id} className="rounded-2xl px-4 py-3 flex items-center gap-3"
                    style={{ background: 'rgba(78,205,196,0.07)', border: '1px solid rgba(78,205,196,0.3)' }}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center font-display text-sm flex-shrink-0"
                      style={{ background: 'rgba(78,205,196,0.15)', border: '1px solid rgba(78,205,196,0.4)', color: '#4ecdc4' }}>
                      {p.name.trim().split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm" style={{ color: '#f0f0eb' }}>{p.name}</div>
                      <div className="text-[11px]" style={{ color: '#7878a8' }}>{p.email}</div>
                    </div>
                    <button onClick={() => acceptStudent(p.id)}
                      className="px-3 py-2 rounded-xl font-bold text-xs uppercase tracking-widest active:scale-95 transition-all flex-shrink-0"
                      style={{ background: '#4ecdc4', color: '#080810' }}>
                      Accept
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                    <div key={s.id} className="rounded-2xl overflow-hidden" style={{ background: '#111120', border: `1px solid ${hasReview ? 'rgba(232,197,71,0.3)' : 'rgba(255,255,255,0.06)'}` }}>
                      {/* Main card body — not tappable */}
                      <div className="px-4 pt-3 pb-3">
                        {/* Name row */}
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center font-display text-sm flex-shrink-0"
                            style={{ background: 'rgba(232,197,71,0.12)', border: '1px solid rgba(232,197,71,0.3)', color: '#e8c547' }}>
                            {initials}
                          </div>
                          <span className="font-bold text-base leading-none flex-1 min-w-0 truncate" style={{ color: '#f0f0eb' }}>{s.name}</span>
                          {hasReview && (
                            <button onClick={() => { setStudentReviewSheet(s.id); setSheetNotes({}) }}
                              className="text-[10px] font-bold px-2 py-1 rounded-full active:scale-95 transition-all flex-shrink-0"
                              style={{ background: 'rgba(232,197,71,0.15)', color: '#e8c547', border: '1px solid rgba(232,197,71,0.35)' }}>
                              {toReview} to review →
                            </button>
                          )}
                          {unreadMsgs > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0" style={{ background: '#e8c547', color: '#080810' }}>{unreadMsgs}</span>}
                        </div>
                        {/* Stage progress boxes */}
                        <div className="grid grid-cols-3 gap-1.5">
                          {stageStats.map((st, si) => {
                            const c = colours[si]
                            const stageName = ['Foundations', 'Advanced', 'Mastery'][si]
                            const signed = !!getSignoff(s.id, si)
                            const pctVal = st.total ? Math.round(st.done / st.total * 100) : 0
                            return (
                              <div key={si} className="rounded-xl px-2 py-2"
                                style={{ background: signed ? 'rgba(46,204,113,0.07)' : `rgba(${si===0?'232,197,71':si===1?'78,205,196':'192,191,224'},0.06)`, border: `1px solid ${signed ? 'rgba(46,204,113,0.25)' : `rgba(${si===0?'232,197,71':si===1?'78,205,196':'192,191,224'},0.18)`}` }}>
                                <div className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: signed ? '#2ecc71' : c }}>{signed ? '✓ ' : ''}{stageName}</div>
                                <div className="font-display" style={{ fontSize: 20, color: signed ? '#2ecc71' : c, lineHeight: 1 }}>{pctVal}%</div>
                                <div className="h-1 rounded-full mt-1.5 overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)' }}>
                                  <div className="h-full rounded-full transition-all" style={{ width: `${pctVal}%`, background: signed ? '#2ecc71' : c }} />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                        <div className="text-[10px] mt-2 text-right" style={{ color: '#8888b0' }}>{timeAgo(sLastSession?.started_at)}</div>
                      </div>
                      {/* Quick actions */}
                      <div className="flex border-t" style={{ borderColor: '#1a1a2e' }}>
                        <button onClick={() => { setSelectedStudentId(s.id); setTab('messages') }}
                          className="flex-1 py-2.5 text-xs font-bold uppercase tracking-widest active:bg-white/5 transition-all"
                          style={{ color: unreadMsgs > 0 ? '#e8c547' : '#8888b0', borderRight: '1px solid #1a1a2e' }}>
                          💬 Message{unreadMsgs > 0 ? ` (${unreadMsgs})` : ''}
                        </button>
                        {hasReview && (
                          <button onClick={() => { setStudentReviewSheet(s.id); setSheetNotes({}) }}
                            className="flex-1 py-2.5 text-xs font-bold uppercase tracking-widest active:bg-white/5 transition-all"
                            style={{ color: '#e8c547', borderRight: '1px solid #1a1a2e' }}>
                            📋 REVIEW ({toReview})
                          </button>
                        )}
                        <button onClick={() => openProfile(s.id)}
                          className="flex-1 py-2.5 text-xs font-bold uppercase tracking-widest active:bg-white/5 transition-all"
                          style={{ color: '#9898c0' }}>
                          👤 PROFILE
                        </button>
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
          <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={() => { setProfileSheet(null); setEditMode(false) }}>
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, maxHeight: '84vh', background: '#111120', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 24, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* Sticky top handle + close */}
              <div className="flex-shrink-0 relative flex items-center justify-center px-4 pt-3 pb-2">
                <div className="w-10 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.07)' }} />
                <button onClick={() => { setProfileSheet(null); setEditMode(false) }}
                  className="absolute right-4 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ background: 'rgba(255,255,255,0.06)', color: '#9898c0' }}>✕</button>
              </div>
              <div className="overflow-y-auto flex-1">

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
                                  <span style={{ color: hasReview ? '#e8c547' : colours[si], flexShrink: 0 }}>
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
                                  style={{ color: '#e8c547', border: '1px solid rgba(232,197,71,0.3)', background: 'rgba(232,197,71,0.06)' }}>
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
                            <button onClick={() => { setProfileSheet(null); setStudentReviewSheet(profileSheet); setSheetNotes({}) }}
                              className="flex-1 py-4 rounded-2xl font-display text-xl tracking-wide active:scale-[0.98] transition-all"
                              style={{ background: 'rgba(232,197,71,0.08)', border: '1px solid rgba(232,197,71,0.35)', color: '#e8c547', letterSpacing: '0.06em' }}>
                              📋 REVIEW
                            </button>
                          )}
                        </div>
                      )
                    })()}
                  </>
                )}
              </div>
              </div>{/* end overflow-y-auto */}
            </div>
          </div>
        )
      })()}

      {/* Student review sheet — all pending answers for one student */}
      {studentReviewSheet && (() => {
        const srs = localStudents.find(s => s.id === studentReviewSheet)!
        if (!srs) return null
        const pendingDays: { si: number; di: number }[] = []
        for (let si = 0; si < 3; si++) {
          for (let di = 0; di < STAGES[si].days.length; di++) {
            const hasCompleted = localTasks.some(t => t.student_id === srs.id && t.stage_idx === si && t.day_idx === di && t.completed)
            const alreadyReviewed = remarks.some(r => r.student_id === srs.id && r.stage_idx === si && r.day_idx === di)
            if (hasCompleted && !alreadyReviewed && !getSignoff(srs.id, si)) pendingDays.push({ si, di })
          }
        }
        const totalAnswers = pendingDays.reduce((acc, { si, di }) =>
          acc + STAGES[si].days[di].tasks.filter((_, ti) => localTasks.find(t => t.student_id === srs.id && t.stage_idx === si && t.day_idx === di && t.task_idx === ti && t.answer)).length, 0)
        return (
          <div className="fixed inset-0 z-[200] flex flex-col" style={{ background: '#080810' }}>
            {/* Sheet header */}
            <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)', background: '#080810' }}>
              <button onClick={() => { setStudentReviewSheet(null); setSheetNotes({}) }}
                className="flex items-center gap-2 font-bold text-sm active:scale-95 transition-all"
                style={{ color: '#9898c0' }}>
                ← Back
              </button>
              <div className="text-center">
                <div className="font-display text-xl" style={{ color: '#f0f0eb', letterSpacing: '0.06em' }}>{srs.name.split(' ')[0].toUpperCase()}</div>
                <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#e8c547' }}>{totalAnswers} answer{totalAnswers !== 1 ? 's' : ''} to review</div>
              </div>
              <button
                onClick={() => saveAllSheetNotes(srs.id)}
                disabled={saving !== null}
                className="font-bold text-sm px-3 py-2 rounded-xl active:scale-95 transition-all disabled:opacity-50"
                style={{ background: '#e8c547', color: '#080810' }}>
                Save all
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-6 pb-8">
              {pendingDays.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
                  <div className="font-display text-4xl mb-3" style={{ color: '#2ecc71' }}>ALL CLEAR</div>
                  <p style={{ color: '#9898c0' }}>Nothing pending for {srs.name.split(' ')[0]}.</p>
                </div>
              ) : pendingDays.map(({ si, di }) => {
                const day = STAGES[si].days[di]
                const dayNum = String(si * 10 + di + 1).padStart(2, '0')
                const colour = colours[si]
                const dayDataRow = allDayData.find(d => d.student_id === srs.id && d.stage_idx === si && d.day_idx === di)
                const noteKey = `${si}-${di}`
                const existingRemark = remarks.find(r => r.student_id === srs.id && r.stage_idx === si && r.day_idx === di)
                const writtenAnswers = day.tasks.map((task, ti) => {
                  const prog = localTasks.find(t => t.student_id === srs.id && t.stage_idx === si && t.day_idx === di && t.task_idx === ti)
                  if (!prog?.answer) return null
                  return { ti, task, prog, needsWork: (prog.score ?? 0) < 60 }
                }).filter(Boolean)
                return (
                  <div key={`${si}-${di}`} className="flex flex-col gap-3">
                    {/* Day header */}
                    <div className="rounded-2xl px-4 py-3" style={{ borderLeft: `4px solid ${colour}`, background: '#111120' }}>
                      <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: colour }}>Stage {si + 1} · Day {dayNum}</div>
                      <div className="font-display text-xl leading-tight" style={{ color: '#f0f0eb', letterSpacing: '0.04em' }}>{day.title}</div>
                      <div className="flex gap-2 mt-2 flex-wrap">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={dayDataRow?.manual_read_at ? { background: 'rgba(78,205,196,0.12)', color: '#4ecdc4', border: '1px solid rgba(78,205,196,0.3)' } : { background: 'rgba(255,255,255,0.04)', color: '#5a5a7a', border: '1px solid rgba(255,255,255,0.06)' }}>
                          📖 {dayDataRow?.manual_read_at ? 'Manual read ✓' : 'NOT read'}
                        </span>
                        {writtenAnswers.length > 0 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: 'rgba(232,197,71,0.12)', color: '#e8c547', border: '1px solid rgba(232,197,71,0.3)' }}>
                            {writtenAnswers.length} written answer{writtenAnswers.length !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Written answers */}
                    {writtenAnswers.map(item => {
                      if (!item) return null
                      const { ti, task, prog, needsWork } = item
                      return (
                        <div key={ti} className="rounded-2xl overflow-hidden" style={{ background: '#0c0c18', border: `1px solid ${needsWork ? 'rgba(255,107,157,0.35)' : 'rgba(46,204,113,0.25)'}` }}>
                          <div className="px-4 pt-3 pb-2" style={{ borderBottom: `1px solid ${needsWork ? 'rgba(255,107,157,0.1)' : 'rgba(46,204,113,0.08)'}` }}>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#8888b0' }}>Task {ti + 1}</span>
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={needsWork
                                ? { background: 'rgba(255,107,157,0.15)', color: '#ff6b9d', border: '1px solid rgba(255,107,157,0.3)' }
                                : { background: 'rgba(46,204,113,0.12)', color: '#2ecc71', border: '1px solid rgba(46,204,113,0.3)' }}>
                                {prog.score ?? 0}% {needsWork ? '· needs work' : '· passed'}
                              </span>
                            </div>
                            <p className="text-sm leading-snug font-medium" style={{ color: '#c0c0d8' }}>{task.text}</p>
                          </div>
                          <div className="px-4 py-3">
                            <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: needsWork ? '#ff6b9d' : '#2ecc71' }}>Student's Answer</div>
                            <p className="text-base leading-relaxed" style={{ color: '#f0f0eb' }}>{prog.answer}</p>
                          </div>
                        </div>
                      )
                    })}

                    {/* Video */}
                    {dayDataRow?.video_url && (
                      <div className="rounded-xl px-4 py-3" style={{ background: '#0c0c18', border: '1px solid rgba(78,205,196,0.25)' }}>
                        <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#4ecdc4' }}>▶ VIDEO</div>
                        <a href={dayDataRow.video_url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold underline truncate block" style={{ color: '#4ecdc4' }}>{dayDataRow.video_url}</a>
                      </div>
                    )}

                    {/* Reflection */}
                    {dayDataRow?.reflection && (
                      <div className="rounded-xl px-4 py-3" style={{ background: '#0c0c18', borderLeft: '3px solid rgba(255,255,255,0.12)' }}>
                        <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#9898c0' }}>REFLECTION</div>
                        <p className="text-sm italic leading-relaxed" style={{ color: '#d4d4ea' }}>{dayDataRow.reflection}</p>
                      </div>
                    )}

                    {/* Coach note for this day */}
                    <div>
                      <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: existingRemark ? '#2ecc71' : '#9898c0' }}>
                        {existingRemark ? '✓ Note saved — edit to update' : 'Your coaching note'}
                      </div>
                      <textarea
                        className="inp"
                        value={sheetNotes[noteKey] ?? existingRemark?.remark ?? ''}
                        onChange={e => setSheetNotes(prev => ({ ...prev, [noteKey]: e.target.value }))}
                        placeholder="Feedback for this day…"
                        style={{ minHeight: 72, fontSize: 15 }}
                      />
                    </div>
                    <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />
                  </div>
                )
              })}

              {/* Save all button at bottom */}
              {pendingDays.length > 0 && (
                <button
                  onClick={() => saveAllSheetNotes(srs.id)}
                  disabled={saving !== null}
                  className="w-full font-display text-2xl tracking-wide py-5 rounded-2xl active:scale-[0.98] transition-all disabled:opacity-50 mt-2"
                  style={{ background: '#e8c547', color: '#080810', letterSpacing: '0.05em' }}>
                  {saving ? 'SAVING…' : 'SAVE NOTES & DONE ✓'}
                </button>
              )}
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
