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

type Tab = 'overview' | 'tasks' | 'messages'

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
    // "done" = completed practical tasks OR written tasks with score >= 60
    const done = stageTasks.filter(t => {
      if (!t.completed) return false
      if (t.answer !== null) return (t.score ?? 0) >= 60
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
      <div className="sticky top-0 z-50 flex items-center justify-between px-4" style={{ background: '#080810', borderBottom: '1px solid #1a1a2e', height: 56 }}>
        <div className="flex items-center gap-2">
          <div className="w-1 h-7 rounded-full flex-shrink-0" style={{ background: '#e8c547' }} />
          <span className="font-display text-xl tracking-widest" style={{ color: '#f0f0eb', letterSpacing: '0.1em' }}>RIDE <span style={{ color: '#e8c547' }}>INSTRUCTOR</span> PATHWAY</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full flex items-center justify-center font-display text-base flex-shrink-0" style={{ background: 'rgba(232,197,71,0.15)', border: '1px solid rgba(232,197,71,0.4)', color: '#e8c547' }}>{coachInitials}</div>
          <button onClick={signOut} className="text-xs font-bold px-3 py-2 rounded-lg" style={{ border: '1px solid rgba(255,255,255,0.07)', color: '#9898c0', background: 'none', minHeight: 36 }}>Sign out</button>
        </div>
      </div>

      {tab === 'messages' && student ? (
        /* ── MESSAGES FULL SCREEN ── */
        <div className="flex flex-col" style={{ height: 'calc(100dvh - 56px)' }}>
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
      ) : tab === 'tasks' && student ? (
        /* ── TASKS FULL SCREEN ── */
        <div className="px-4 mt-4 flex flex-col gap-5 pb-10">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={() => setTab('overview')}
              className="flex items-center justify-center rounded-xl flex-shrink-0 font-bold active:scale-95 transition-all"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)', color: '#9898c0', minWidth: 44, minHeight: 44, fontSize: 20 }}>
              ←
            </button>
            <div className="flex-1 font-display tracking-wide" style={{ fontSize: 26, color: '#f0f0eb', letterSpacing: '0.06em' }}>
              TASKS — <span style={{ color: '#e8c547' }}>{student.name.split(' ')[0].toUpperCase()}</span>
            </div>
            <button onClick={() => setTab('overview')}
              className="text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-xl active:scale-95 transition-all flex-shrink-0"
              style={{ background: 'rgba(232,197,71,0.1)', border: '1px solid rgba(232,197,71,0.3)', color: '#e8c547' }}>
              DONE →
            </button>
          </div>
          {[0,1,2].map(si => {
            const { done, completed } = countTasks(student.id, si)
            const hasReview = completed > done
            if (getSignoff(student.id, si) && !hasReview) return null
            const daysWithWork = STAGES[si].days.filter((_, di) =>
              allTasks.some(t => t.student_id === student.id && t.stage_idx === si && t.day_idx === di && t.completed)
            )
            if (daysWithWork.length === 0) return null
            return (
            <div key={si}>
              <div className="flex items-center gap-3 mb-3" style={{ borderLeft: `3px solid ${colours[si]}`, paddingLeft: 12 }}>
                <div className="font-display text-2xl tracking-wide" style={{ color: colours[si], letterSpacing: '0.06em' }}>STAGE {si + 1}</div>
                <div className="text-base font-semibold" style={{ color: '#7878a8' }}>{stageNames[si]}</div>
              </div>
              <div className="flex flex-col gap-2">
                {STAGES[si].days.map((day, di) => {
                  const doneCount = allTasks.filter(t => t.student_id === student.id && t.stage_idx === si && t.day_idx === di && t.completed).length
                  if (doneCount === 0) return null
                  const rowKey = `${student.id}-${si}-${di}`
                  const isOpen = expandedDays.has(rowKey)
                  const allDone = doneCount === day.tasks.length
                  const dayDataRow = allDayData.find(d => d.student_id === student.id && d.stage_idx === si && d.day_idx === di)
                  const remarkRow = remarks.find(r => r.student_id === student.id && r.stage_idx === si && r.day_idx === di)
                  const dayNum = String(si * 10 + di + 1).padStart(2, '0')
                  return (
                    <div key={di} className="rounded-2xl overflow-hidden" style={{ background: '#111120', border: `1px solid ${allDone ? 'rgba(46,204,113,0.2)' : 'rgba(255,255,255,0.05)'}` }}>
                      <button onClick={() => setExpandedDays(prev => { const n = new Set(prev); if (isOpen) n.delete(rowKey); else n.add(rowKey); return n })}
                        className="flex items-center gap-3 w-full px-4 py-4 text-left active:bg-white/5" style={{ minHeight: 64 }}>
                        <div className="font-display text-2xl flex-shrink-0 w-10 text-center" style={{ color: allDone ? '#2ecc71' : colours[si] }}>{dayNum}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-base font-semibold truncate" style={{ color: allDone ? '#9898c0' : '#f0f0eb' }}>{day.title}</div>
                          <div className="text-xs mt-0.5 font-bold uppercase tracking-widest" style={{ color: allDone ? '#2ecc71' : '#7878a8' }}>
                            {doneCount}/{day.tasks.length} tasks{remarkRow ? ' · ✓ note' : ''}{dayDataRow?.manual_read_at ? ' · 📖 read' : ''}
                          </div>
                        </div>
                        <span style={{ color: '#7878a8', fontSize: 16, transform: isOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s', flexShrink: 0 }}>▾</span>
                      </button>
                      {isOpen && (
                        <div className="px-4 pb-5" style={{ borderTop: '1px solid #1a1a2e' }}>
                          <div className="flex items-center gap-2 mt-4">
                            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: dayDataRow?.manual_read_at ? '#2ecc71' : '#60608a' }}>📖 Manual</span>
                            {dayDataRow?.manual_read_at
                              ? <span className="text-xs px-2 py-1 rounded-lg font-bold" style={{ background: 'rgba(46,204,113,0.1)', color: '#2ecc71', border: '1px solid rgba(46,204,113,0.2)' }}>Read {new Date(dayDataRow.manual_read_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
                              : <span className="text-xs px-2 py-1 rounded-lg font-bold" style={{ color: '#60608a', border: '1px solid #1a1a2e' }}>Not opened</span>}
                          </div>
                          {dayDataRow?.reflection && (
                            <div className="mt-4">
                              <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#7878a8' }}>Student Reflection</div>
                              <div className="text-sm italic leading-relaxed px-4 py-3 rounded-xl" style={{ background: '#0c0c18', color: '#a0a0c0', borderLeft: '2px solid rgba(255,255,255,0.07)' }}>{dayDataRow.reflection}</div>
                            </div>
                          )}
                          {dayDataRow?.video_url && (
                            <div className="mt-4">
                              <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#7878a8' }}>Video Submission</div>
                              <a href={dayDataRow.video_url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold underline block truncate" style={{ color: '#4ecdc4' }}>{dayDataRow.video_url}</a>
                            </div>
                          )}
                          <div className="text-xs font-bold uppercase tracking-widest mt-4 mb-2" style={{ color: '#7878a8' }}>Coach Note</div>
                          <textarea className="inp" placeholder="Leave a coaching note for this day…" defaultValue={remarkRow?.remark ?? ''} style={{ minHeight: 80, fontSize: 15 }} id={`remark-${rowKey}`} />
                          <button onClick={() => { const ta = document.getElementById(`remark-${rowKey}`) as HTMLTextAreaElement; if (ta) saveRemark(student.id, si, di, ta.value) }}
                            className="w-full mt-3 rounded-xl font-display text-2xl tracking-wide active:scale-[0.98] transition-all"
                            style={{ background: saving === rowKey ? 'rgba(255,255,255,0.07)' : '#e8c547', color: saving === rowKey ? '#9898c0' : '#0a0a12', letterSpacing: '0.04em', minHeight: 56 }}>
                            {saving === rowKey ? 'SAVING…' : '✓ TICK & SAVE'}
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            )
          })}

          {/* Bottom nav back */}
          <button
            onClick={() => setTab('overview')}
            className="w-full font-display text-2xl tracking-widest py-5 rounded-2xl active:scale-[0.98] transition-all mt-2"
            style={{ background: '#e8c547', color: '#080810', letterSpacing: '0.06em' }}
          >
            ← BACK TO OVERVIEW
          </button>
        </div>
      ) : (
        /* ── HOME: Summary → Messages → Students ── */
        <div className="px-4 flex flex-col gap-6 pt-5">

          {/* Hero */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-bold uppercase tracking-widest mb-2" style={{ color: '#9898c0' }}>COACH DASHBOARD</div>
              <h1 className="font-display leading-none" style={{ fontSize: 44, letterSpacing: '0.02em', color: '#f0f0eb', lineHeight: 0.9 }}>
                HELLO,<br /><span style={{ color: '#e8c547' }}>{coach.name.split(' ')[0].toUpperCase()}.</span>
              </h1>
            </div>
            <div className="text-right flex-shrink-0 pt-1">
              <div className="font-display" style={{ fontSize: 28, color: '#f0f0eb', letterSpacing: '0.02em', lineHeight: 1 }}>{time}</div>
              <div className="text-sm mt-1 font-semibold" style={{ color: '#7878a8' }}>{today}</div>
            </div>
          </div>

          {/* ① Summary */}
          <div>
            <div className="text-sm font-bold uppercase tracking-widest mb-3" style={{ color: '#9898c0' }}>SUMMARY</div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'STUDENTS', value: totalStudents, color: '#e8c547' },
                { label: 'SIGN-OFFS', value: totalSignoffs, color: '#2ecc71' },
                { label: 'PENDING', value: pendingSignoffs, color: '#ff6b9d' },
              ].map(s => (
                <div key={s.label} className="rounded-2xl px-3 py-4 flex flex-col items-center" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="font-display" style={{ fontSize: 40, color: s.color, lineHeight: 1 }}>{s.value}</div>
                  <div className="text-[10px] font-bold tracking-widest mt-1.5 text-center" style={{ color: '#60608a' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ② Messages */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-bold uppercase tracking-widest" style={{ color: '#9898c0' }}>MESSAGES</div>
              {allUnread.length > 0 && <span className="text-[10px] font-bold px-2 py-1 rounded-full" style={{ background: '#ff6b9d', color: '#fff' }}>{allUnread.length} UNREAD</span>}
            </div>
            {(() => {
              const studentsWithMessages = localStudents.filter(s => messages.some(m => m.student_id === s.id && m.from_role === 'student' && !m.read))
              if (studentsWithMessages.length === 0) {
                return (
                  <div className="rounded-2xl px-4 py-5 text-sm" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.06)', color: '#7878a8' }}>
                    No messages yet
                  </div>
                )
              }
              return (
                <div className="flex flex-col gap-2">
                  {studentsWithMessages.map(s => {
                    const lastMsg = messages.filter(m => m.student_id === s.id).slice(-1)[0]
                    const unread = messages.filter(m => m.student_id === s.id && m.from_role === 'student' && !m.read).length
                    return (
                      <button key={s.id} onClick={() => { setSelectedStudentId(s.id); setTab('messages') }}
                        className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl text-left active:scale-[0.98] transition-all"
                        style={{ background: '#111120', border: `1px solid ${unread ? 'rgba(255,107,157,0.3)' : 'rgba(255,255,255,0.06)'}`, borderLeft: `4px solid ${unread ? '#ff6b9d' : '#e8c547'}` }}>
                        <div className="w-10 h-10 rounded-full flex items-center justify-center font-display text-base flex-shrink-0"
                          style={{ background: 'rgba(232,197,71,0.12)', border: '1px solid rgba(232,197,71,0.3)', color: '#e8c547' }}>
                          {s.name.trim().split(' ').map((w: string) => w[0]).join('').substring(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-base font-bold" style={{ color: '#f0f0eb' }}>{s.name}</div>
                          <div className="text-sm truncate mt-0.5" style={{ color: '#7878a8' }}>{lastMsg.text}</div>
                        </div>
                        {unread > 0 && <span className="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center flex-shrink-0" style={{ background: '#ff6b9d', color: '#fff' }}>{unread}</span>}
                      </button>
                    )
                  })}
                </div>
              )
            })()}
          </div>

          {/* ③ Student overview — one card per student */}
          <div>
            <div className="text-sm font-bold uppercase tracking-widest mb-3" style={{ color: '#9898c0' }}>STUDENT OVERVIEW</div>
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
              <div className="flex flex-col gap-4">
                {localStudents.map(s => {
                  const sLastSession = lastSessions.find(x => x.user_id === s.id)
                  return (
                    <div key={s.id} className="rounded-2xl p-5" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.06)' }}>
                      {/* Student header */}
                      <div className="flex items-start justify-between mb-4 cursor-pointer" onClick={() => openProfile(s.id)}>
                        <div>
                          <div className="font-display tracking-wide leading-none" style={{ fontSize: 32, color: '#f0f0eb' }}>{s.name.toUpperCase()}</div>
                          <div className="text-sm mt-1.5 font-semibold" style={{ color: '#7878a8' }}>
                            {s.location ?? 'No location'} · Started {formatDate(s.start_date)}
                          </div>
                          <div className="text-sm mt-1.5 font-bold uppercase tracking-widest" style={{ color: '#e8c547' }}>TAP TO VIEW PROFILE →</div>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: '#60608a' }}>Last active</div>
                          <div className="text-base font-bold mt-1" style={{ color: '#4ecdc4' }}>{timeAgo(sLastSession?.started_at)}</div>
                        </div>
                      </div>

                      {/* Stage rows */}
                      {[0,1,2].map(si => {
                        const { total, done, completed, pct } = countTasks(s.id, si)
                        const signed = !!getSignoff(s.id, si)
                        const unlocked = si === 0 || !!getSignoff(s.id, si - 1)
                        const stageComplete = done === total && total > 0
                        return (
                          <div key={si} className="flex flex-col gap-2 py-3" style={{ borderTop: '1px solid #1a1a2e' }}>
                            <div className="flex items-center gap-3">
                              <div className="font-display flex-shrink-0 text-center" style={{ color: colours[si], width: 32, fontSize: 18 }}>S{si + 1}</div>
                              <div className="flex-1 min-w-0">
                                <div className="flex justify-between text-sm font-semibold mb-1.5" style={{ color: '#9898c0' }}>
                                  <span className="truncate mr-2">{stageNames[si]}</span>
                                  <button
                                    onClick={() => { setSelectedStudentId(s.id); setTab('tasks') }}
                                    className="active:scale-95 transition-all flex-shrink-0 rounded-lg px-1.5 py-0.5 -mr-1"
                                    style={{
                                      color: stageComplete ? '#2ecc71' : completed < total ? colours[si] : '#ff6b9d',
                                      background: !signed && completed > done ? 'rgba(255,107,157,0.08)' : 'transparent',
                                      border: !signed && completed > done ? '1px solid rgba(255,107,157,0.25)' : '1px solid transparent',
                                    }}
                                  >
                                    {done}/{total}{!signed && completed > done ? ` · ${completed - done} to review ↗` : ''}
                                  </button>
                                </div>
                                <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1a1a2e' }}>
                                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: stageComplete ? '#2ecc71' : colours[si] }} />
                                </div>
                              </div>
                              {signed ? (
                                <span className="text-xs font-bold px-2 py-1.5 rounded-lg flex-shrink-0" style={{ background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.3)', color: '#2ecc71' }}>✓ SIGNED</span>
                              ) : unlocked && stageComplete ? (
                                <button onClick={() => setSignoffModal({ stageIdx: si, studentId: s.id })}
                                  className="text-xs font-bold px-2 py-1.5 rounded-lg flex-shrink-0 transition-all active:scale-95"
                                  style={{ background: 'rgba(232,197,71,0.12)', border: '1px solid rgba(232,197,71,0.4)', color: '#e8c547', minHeight: 36 }}>
                                  SIGN OFF
                                </button>
                              ) : unlocked && !stageComplete ? (
                                <span className="text-xs px-2 py-1.5 rounded-lg flex-shrink-0 font-bold" style={{ color: '#ff6b9d', border: '1px solid rgba(255,107,157,0.2)' }}>IN PROGRESS</span>
                              ) : (
                                <span className="text-xs px-2 py-1.5 rounded-lg flex-shrink-0 font-bold" style={{ color: '#60608a', border: '1px solid #1a1a2e' }}>LOCKED</span>
                              )}
                            </div>
                            {signed && (
                              <div className="flex items-center justify-between pl-10">
                                <div className="text-xs" style={{ color: '#60608a' }}>
                                  Signed {formatDate(getSignoff(s.id, si)?.signed_at ?? null)}
                                </div>
                                <button onClick={() => revokeSignoff(s.id, si)}
                                  className="text-xs font-bold px-2 py-1 rounded-lg transition-all active:scale-95"
                                  style={{ color: '#ff6b9d', border: '1px solid rgba(255,107,157,0.2)', background: 'rgba(255,107,157,0.05)' }}>
                                  UNDO
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}

                      {/* Quick actions */}
                      <div className="flex gap-2 mt-4 pt-4" style={{ borderTop: '1px solid #1a1a2e' }}>
                        <button onClick={() => { setSelectedStudentId(s.id); setTab('messages') }}
                          className="flex-1 py-3 rounded-xl font-display text-lg tracking-wide active:scale-[0.98] transition-all"
                          style={{ background: 'rgba(232,197,71,0.08)', border: '1px solid rgba(232,197,71,0.25)', color: '#e8c547', letterSpacing: '0.04em' }}>
                          💬 MSG
                        </button>
                        <button onClick={() => { setSelectedStudentId(s.id); setTab('tasks') }}
                          className="flex-1 py-3 rounded-xl font-display text-lg tracking-wide active:scale-[0.98] transition-all"
                          style={{ background: 'rgba(78,205,196,0.08)', border: '1px solid rgba(78,205,196,0.25)', color: '#4ecdc4', letterSpacing: '0.04em' }}>
                          📋 TASKS
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
                      {stageStats.map((s, si) => (
                        <div key={si} className="flex items-center gap-3 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                          <div className="font-display text-xl flex-shrink-0 w-8 text-center" style={{ color: colours[si] }}>S{si + 1}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between text-sm font-semibold mb-1.5" style={{ color: '#9898c0' }}>
                              <span className="truncate mr-2">{stageNames[si]}</span>
                              <span style={{ color: colours[si], flexShrink: 0 }}>{s.done}/{s.total}</span>
                            </div>
                            <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1a1a2e' }}>
                              <div className="h-full rounded-full" style={{ width: `${s.pct}%`, background: colours[si] }} />
                            </div>
                          </div>
                          {s.signed
                            ? <span className="text-xs font-bold px-2 py-1 rounded-lg flex-shrink-0" style={{ background: 'rgba(46,204,113,0.1)', color: '#2ecc71' }}>✓ SIGNED</span>
                            : <span className="text-xs font-bold px-2 py-1 rounded-lg flex-shrink-0" style={{ color: '#60608a', border: '1px solid #1a1a2e' }}>{s.pct}%</span>}
                        </div>
                      ))}
                    </div>

                    {/* Quick actions */}
                    <div className="flex gap-3 pb-2">
                      <button onClick={() => { setProfileSheet(null); setTab('messages') }}
                        className="flex-1 py-4 rounded-2xl font-display text-xl tracking-wide active:scale-[0.98] transition-all"
                        style={{ background: 'rgba(232,197,71,0.08)', border: '1px solid rgba(232,197,71,0.3)', color: '#e8c547', letterSpacing: '0.06em' }}>
                        💬 MESSAGE
                      </button>
                      <button onClick={() => { setProfileSheet(null); setTab('tasks') }}
                        className="flex-1 py-4 rounded-2xl font-display text-xl tracking-wide active:scale-[0.98] transition-all"
                        style={{ background: 'rgba(78,205,196,0.08)', border: '1px solid rgba(78,205,196,0.3)', color: '#4ecdc4', letterSpacing: '0.06em' }}>
                        📋 TASKS
                      </button>
                    </div>
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
