'use client'

import { useState, useEffect } from 'react'
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
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function CoachDashboard({
  coach, students, allTasks, allDayData, allRemarks, allSignoffs, allMessages, lastSessions, coachId
}: Props) {
  const router = useRouter()
  const supabase = createClient()
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

  const student = students.find(s => s.id === selectedStudentId)
  const lastSession = lastSessions.find(s => s.user_id === selectedStudentId)

  const unreadCount = messages.filter(m => m.student_id === selectedStudentId && m.from_role === 'student' && !m.read).length
  const coachInitials = coach.name.trim().split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()

  // Realtime messages
  useEffect(() => {
    if (!selectedStudentId) return
    const channel = supabase
      .channel('coach-messages')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `student_id=eq.${selectedStudentId}`,
      }, payload => setMessages(prev => [...prev, payload.new as Message]))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [selectedStudentId])

  // Mark student messages as read when on messages tab
  useEffect(() => {
    if (tab === 'messages' && selectedStudentId) {
      supabase.from('messages').update({ read: true })
        .eq('student_id', selectedStudentId).eq('from_role', 'student').eq('read', false).then(() => {})
    }
  }, [tab, selectedStudentId])

  function countTasks(studentId: string, si: number) {
    const stageTasks = allTasks.filter(t => t.student_id === studentId && t.stage_idx === si)
    const total = STAGES[si].days.reduce((a, d) => a + d.tasks.length, 0)
    const done = stageTasks.filter(t => t.completed).length
    return { total, done, pct: total ? Math.round(done / total * 100) : 0 }
  }

  function getSignoff(studentId: string, si: number) {
    return signoffs.find(s => s.student_id === studentId && s.stage_idx === si)
  }

  function isStageUnlocked(studentId: string, si: number) {
    if (si === 0) return true
    return !!getSignoff(studentId, si - 1)
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
  }

  async function confirmSignoff() {
    if (!signoffModal) return
    const { stageIdx, studentId } = signoffModal
    const { data } = await supabase.from('stage_signoffs').insert({
      student_id: studentId,
      coach_id: coachId,
      stage_idx: stageIdx,
      note: signoffNote || null,
    }).select().single()
    if (data) setSignoffs(prev => [...prev, data as StageSignoff])
    setSignoffModal(null)
    setSignoffNote('')
  }

  async function sendMessage() {
    const trimmed = chatText.trim()
    if (!trimmed || sending || !selectedStudentId) return
    setSending(true)
    setChatText('')

    const { data } = await supabase.from('messages').insert({
      student_id: selectedStudentId,
      sender_id: coachId,
      from_role: 'coach',
      text: trimmed,
    }).select().single()

    if (data) setMessages(prev => [...prev, data as Message])

    // mailto to student
    const studentEmail = student?.email
    if (studentEmail) {
      const subject = encodeURIComponent(`RIP Update — Message from your coach`)
      const body = encodeURIComponent(`${trimmed.substring(0, 200)}\n\n— ${coach.name}`)
      window.open(`mailto:${studentEmail}?subject=${subject}&body=${body}`, '_blank')
    }
    setSending(false)
  }

  async function sendSignedUpdate(si: number) {
    if (!student) return
    const { total, done } = countTasks(student.id, si)
    const signoff = getSignoff(student.id, si)
    const subject = encodeURIComponent(`RIP Update — Stage ${si + 1} signed off — ${student.name}`)
    const stageName = ['Mastering Music', 'Magic in Movement', 'Finding Your Voice'][si]
    const body = encodeURIComponent(
      `Stage ${si + 1} — ${stageName}\n\n` +
      `Tasks completed: ${done}/${total} (${Math.round(done/total*100)}%)\n` +
      `Signed off by: ${coach.name}\n` +
      (signoff?.note ? `\nCoach note:\n${signoff.note}\n` : '') +
      `\n— RIDE Instructor Pathway`
    )
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  const colours = ['#e8c547', '#4ecdc4', '#ff6b9d']
  const stageNames = ['Stage 1 — Mastering Music', 'Stage 2 — Magic in Movement', 'Stage 3 — Finding Your Voice']
  const studentMessages = messages.filter(m => m.student_id === selectedStudentId)

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div style={{ background: '#0a0a12', minHeight: '100vh', paddingBottom: 24 }}>
      {/* Topbar */}
      <div className="sticky top-0 z-50 flex items-center justify-between px-4" style={{ background: '#0a0a12', borderBottom: '1px solid #2a2a45', height: 52 }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center font-display text-base flex-shrink-0" style={{ background: 'rgba(232,197,71,0.1)', border: '1px solid rgba(232,197,71,0.4)', color: '#e8c547' }}>
            {coachInitials}
          </div>
          <div className="font-bold text-base leading-none">ASORos <span className="font-normal text-xs" style={{ color: '#7070a0' }}>RIP</span></div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ background: '#e8c547', color: '#0a0a12', border: '1px solid #e8c547' }}>COACH</span>
          <button onClick={signOut} className="text-[11px] px-3 py-1.5 rounded" style={{ border: '1px solid rgba(255,255,255,0.2)', color: '#7070a0', background: 'none' }}>Sign out</button>
        </div>
      </div>

      {/* Coach header + tabs */}
      <div style={{ background: '#1a1a2e', borderBottom: '1px solid #2a2a45' }}>
        <div className="flex items-center justify-between px-4 pt-4 pb-0">
          <div className="font-display text-3xl tracking-wide" style={{ color: '#e8c547' }}>COACH VIEW</div>
          {students.length > 1 && (
            <select
              value={selectedStudentId}
              onChange={e => setSelectedStudentId(e.target.value)}
              className="text-xs px-2 py-1.5 rounded"
              style={{ background: '#0d0d1a', border: '1px solid #2a2a45', color: '#f0f0eb' }}
            >
              {students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
        <div className="flex">
          {(['overview', 'tasks', 'messages'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 py-3 text-[10px] font-bold uppercase tracking-widest relative transition-all"
              style={{
                color: tab === t ? '#e8c547' : '#7070a0',
                background: 'none',
                border: 'none',
                borderBottom: tab === t ? '2px solid #e8c547' : '2px solid transparent',
                cursor: 'pointer',
              }}
            >
              {t}
              {t === 'messages' && unreadCount > 0 && (
                <span className="absolute top-2 right-2 text-[9px] font-bold px-1 rounded" style={{ background: '#ff6b9d', color: '#f0f0eb' }}>
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {!student && (
        <div className="px-4 pt-12 text-center" style={{ color: '#7070a0' }}>
          <p className="text-sm">No students assigned yet.</p>
          <p className="text-xs mt-2">Students connect to you by entering your email during sign-up.</p>
        </div>
      )}

      {/* OVERVIEW TAB */}
      {tab === 'overview' && student && (
        <div>
          {/* Student card */}
          <div className="mx-4 mt-4 px-4 py-3 rounded-xl" style={{ background: '#1a1a2e', border: '1px solid #2a2a45' }}>
            <div className="font-display text-2xl tracking-wide leading-none">{student.name.toUpperCase()}</div>
            <div className="text-[11px] mt-2 leading-relaxed" style={{ color: '#7070a0' }}>
              {student.start_date && `Started: ${formatDate(student.start_date)}`}
              {student.location && ` · ${student.location}`}<br />
              Last active: {timeAgo(lastSession?.started_at)} · {lastSession?.duration_mins ?? 0} mins total
            </div>
          </div>

          {/* Stage rows */}
          {[0, 1, 2].map(si => {
            const { total, done, pct } = countTasks(student.id, si)
            const signed = !!getSignoff(student.id, si)
            const unlocked = isStageUnlocked(student.id, si)
            return (
              <div key={si} className="mx-4 mt-2 px-4 py-3 rounded-xl flex items-center gap-3" style={{ background: '#1a1a2e', border: '1px solid #2a2a45' }}>
                <div className="font-display text-base tracking-wide flex-shrink-0" style={{ color: colours[si], width: 68 }}>STAGE {si + 1}</div>
                <div className="flex-1">
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#2a2a45' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: colours[si] }} />
                  </div>
                  <div className="text-[10px] mt-1" style={{ color: '#7070a0' }}>{pct}% · {done}/{total} tasks</div>
                </div>
                {signed ? (
                  <span className="text-[10px] font-bold px-2 py-1.5 rounded-lg" style={{ background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.3)', color: '#2ecc71' }}>✓ Signed</span>
                ) : unlocked ? (
                  <button
                    onClick={() => setSignoffModal({ stageIdx: si, studentId: student.id })}
                    className="text-[10px] font-bold px-2 py-1.5 rounded-lg"
                    style={{ background: 'rgba(232,197,71,0.08)', border: '1px solid rgba(232,197,71,0.3)', color: '#e8c547', minHeight: 36 }}
                  >
                    Sign Off
                  </button>
                ) : (
                  <span className="text-[10px] px-2 py-1.5 rounded-lg" style={{ color: '#4a4a70', border: '1px solid #2a2a45' }}>Locked</span>
                )}
              </div>
            )
          })}

          {/* Send Signed Update buttons */}
          <div className="mx-4 mt-4 flex flex-col gap-2">
            {[0, 1, 2].map(si => {
              const signed = !!getSignoff(student.id, si)
              if (!signed) return null
              return (
                <button
                  key={si}
                  onClick={() => sendSignedUpdate(si)}
                  className="w-full py-4 rounded-xl font-display text-lg transition-all"
                  style={{ border: '1px solid #2a2a45', background: '#1a1a2e', color: '#f0f0eb', letterSpacing: '0.06em' }}
                >
                  ⇩ Send Signed Update — Stage {si + 1}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* TASKS TAB */}
      {tab === 'tasks' && student && (
        <div>
          {[0, 1, 2].map(si => (
            <div key={si} className="mx-4 mt-4">
              <div className="flex items-center justify-between pb-2" style={{ borderBottom: '1px solid #2a2a45' }}>
                <div className="font-display text-lg tracking-wide" style={{ color: colours[si] }}>{stageNames[si]}</div>
              </div>
              <div className="flex flex-col gap-1.5 mt-2">
                {STAGES[si].days.map((day, di) => {
                  const rowKey = `${student.id}-${si}-${di}`
                  const isOpen = expandedDays.has(rowKey)
                  const doneCount = allTasks.filter(t => t.student_id === student.id && t.stage_idx === si && t.day_idx === di && t.completed).length
                  const dayDataRow = allDayData.find(d => d.student_id === student.id && d.stage_idx === si && d.day_idx === di)
                  const remarkRow = remarks.find(r => r.student_id === student.id && r.stage_idx === si && r.day_idx === di)
                  const dayNum = String(si * 10 + di + 1).padStart(2, '0')

                  return (
                    <div key={di} className="rounded-lg overflow-hidden" style={{ background: '#1a1a2e', border: '1px solid #2a2a45' }}>
                      <button
                        onClick={() => setExpandedDays(prev => { const n = new Set(prev); if (isOpen) n.delete(rowKey); else n.add(rowKey); return n })}
                        className="flex items-center gap-2.5 w-full px-3 py-2.5 text-left"
                        style={{ minHeight: 44 }}
                      >
                        <div className="font-display text-lg" style={{ color: '#7070a0', width: 28, flexShrink: 0 }}>{dayNum}</div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold truncate">{day.title}</div>
                          <div className="text-[9px] mt-0.5" style={{ color: doneCount === day.tasks.length ? '#2ecc71' : '#7070a0' }}>
                            {doneCount}/{day.tasks.length} tasks
                            {remarkRow && <span style={{ color: '#2ecc71' }}> · ✓ note</span>}
                          </div>
                        </div>
                        <span style={{ color: '#7070a0', fontSize: 12, transform: isOpen ? 'rotate(180deg)' : undefined }}>▾</span>
                      </button>

                      {isOpen && (
                        <div className="px-3 pb-3" style={{ borderTop: '1px solid #2a2a45' }}>
                          {dayDataRow?.reflection && (
                            <>
                              <div className="text-[9px] font-bold uppercase tracking-widest mt-3 mb-1" style={{ color: '#7070a0' }}>Learner Reflection</div>
                              <div className="text-xs italic leading-relaxed px-3 py-2 rounded" style={{ background: '#0d0d1a', color: '#7070a0' }}>{dayDataRow.reflection}</div>
                            </>
                          )}
                          {dayDataRow?.video_url && (
                            <>
                              <div className="text-[9px] font-bold uppercase tracking-widest mt-3 mb-1" style={{ color: '#7070a0' }}>Video</div>
                              <a href={dayDataRow.video_url} target="_blank" rel="noopener noreferrer" className="text-xs underline" style={{ color: '#4ecdc4' }}>
                                {dayDataRow.video_url}
                              </a>
                            </>
                          )}

                          <div className="text-[9px] font-bold uppercase tracking-widest mt-3 mb-1" style={{ color: '#7070a0' }}>Coach Note</div>
                          <textarea
                            className="inp"
                            placeholder="Add your coaching note…"
                            defaultValue={remarkRow?.remark ?? ''}
                            style={{ minHeight: 64 }}
                            id={`remark-${rowKey}`}
                          />
                          <button
                            onClick={() => {
                              const ta = document.getElementById(`remark-${rowKey}`) as HTMLTextAreaElement
                              if (ta) saveRemark(student.id, si, di, ta.value)
                            }}
                            className="w-full mt-2 py-3 rounded-lg font-display text-lg tracking-wide transition-opacity"
                            style={{ background: '#e8c547', color: '#0a0a12', minHeight: 44 }}
                          >
                            {saving === rowKey ? 'SAVING…' : '✓ TICK & SAVE'}
                          </button>

                          {/* Task checklist (read-only) */}
                          <div className="mt-3 flex flex-col gap-1.5">
                            {day.tasks.map((task, ti) => {
                              const done = allTasks.find(t => t.student_id === student.id && t.stage_idx === si && t.day_idx === di && t.task_idx === ti)?.completed ?? false
                              return (
                                <div key={ti} className="flex items-start gap-2">
                                  <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 text-[9px] mt-0.5" style={done ? { background: '#2ecc71', color: '#0a0a12' } : { border: '1.5px solid #2a2a45' }}>
                                    {done ? '✓' : ''}
                                  </div>
                                  <div className="text-[11px] leading-snug" style={{ color: done ? '#2ecc71' : '#7070a0' }}>{task.text}</div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MESSAGES TAB */}
      {tab === 'messages' && student && (
        <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 108px)' }}>
          <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
            {studentMessages.length === 0 ? (
              <div className="text-center py-12 text-sm" style={{ color: '#7070a0' }}>No messages yet.</div>
            ) : studentMessages.map(m => {
              const fromMe = m.from_role === 'coach'
              const stageName = m.stage_ref !== null && m.day_ref !== null
                ? `Stage ${m.stage_ref + 1} · Day ${m.stage_ref * 10 + m.day_ref + 1}` : null
              return (
                <div key={m.id} className={`flex flex-col ${fromMe ? 'items-end' : 'items-start'}`}>
                  {stageName && <span className="text-[9px] uppercase tracking-widest px-2 py-0.5 rounded mb-1" style={{ background: 'rgba(255,255,255,0.06)', color: '#7070a0' }}>{stageName}</span>}
                  <div
                    className="max-w-[80%] px-3.5 py-2.5 rounded-xl text-sm leading-snug"
                    style={fromMe
                      ? { background: 'rgba(232,197,71,0.12)', border: '1px solid rgba(232,197,71,0.3)', color: '#f0f0eb', borderBottomRightRadius: 4 }
                      : { background: '#202035', border: '1px solid #2a2a45', color: '#f0f0eb', borderBottomLeftRadius: 4 }
                    }
                  >
                    {m.text}
                  </div>
                  <div className="text-[9px] mt-1" style={{ color: '#7070a0' }}>{timeAgo(m.created_at)}</div>
                </div>
              )
            })}
          </div>
          <div className="flex gap-2 px-4 py-3 items-end" style={{ background: '#0a0a12', borderTop: '1px solid #2a2a45', flexShrink: 0 }}>
            <textarea
              value={chatText}
              onChange={e => setChatText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              placeholder={`Message ${student.name}…`}
              rows={1}
              className="inp flex-1"
              style={{ minHeight: 42, maxHeight: 100, resize: 'none' }}
            />
            <button
              onClick={sendMessage}
              disabled={!chatText.trim() || sending}
              className="font-display text-base px-4 rounded-lg disabled:opacity-40"
              style={{ background: '#e8c547', color: '#0a0a12', minHeight: 42, letterSpacing: '0.04em' }}
            >
              SEND
            </button>
          </div>
        </div>
      )}

      {/* Sign-off modal */}
      {signoffModal && (
        <div className="fixed inset-0 flex items-center justify-center p-6 z-50" style={{ background: 'rgba(0,0,0,0.85)' }}>
          <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: '#1a1a2e', border: '1px solid #2a2a45' }}>
            <div className="font-display text-2xl tracking-wide mb-1" style={{ color: '#e8c547' }}>
              SIGN OFF — STAGE {signoffModal.stageIdx + 1}
            </div>
            <p className="text-xs mb-4" style={{ color: '#7070a0' }}>Add a coaching note for this stage, then confirm.</p>
            <textarea
              className="inp mb-3"
              placeholder="Your overall observation for this stage…"
              value={signoffNote}
              onChange={e => setSignoffNote(e.target.value)}
              style={{ minHeight: 90 }}
            />
            <div className="flex gap-2">
              <button onClick={() => { setSignoffModal(null); setSignoffNote('') }} className="flex-1 py-3 rounded-xl text-xs font-bold" style={{ border: '1px solid #2a2a45', color: '#7070a0', background: 'none', minHeight: 44 }}>Cancel</button>
              <button onClick={confirmSignoff} className="flex-[2] py-3 rounded-xl font-display text-xl tracking-wide" style={{ background: '#2ecc71', color: '#0a0a12', minHeight: 44 }}>SIGN OFF ✓</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
