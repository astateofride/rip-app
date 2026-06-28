'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { STAGES } from '@/lib/stages'
import Topbar from '@/components/Topbar'
import BottomNav from '@/components/BottomNav'
import type { TaskProgress, DayData, CoachRemark, StageSignoff } from '@/lib/types'

interface Props {
  stageIdx: number
  userId: string
  tasks: TaskProgress[]
  dayData: DayData[]
  remarks: CoachRemark[]
  signoffs: StageSignoff[]
  unreadCount: number
}

// Tasks that need written answers (not just a checkbox)
const WRITTEN_TRIGGERS = ['write', 'define', 'describe', 'explain', 'identify', 'compare', 'summarise', 'summarize', 'map', 'list', 'reflect', 'what does', 'how does', 'why does', 'what do', 'how do', 'why do', 'in your own words', 'in one sentence', 'in 2 sentences', 'in 3']

function isWrittenTask(text: string) {
  const lower = text.toLowerCase()
  return WRITTEN_TRIGGERS.some(t => lower.includes(t))
}

// Extract meaningful keywords from manual note text
function extractKeywords(text: string): string[] {
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'each', 'from', 'by', 'as', 'it', 'its', 'this', 'that', 'they', 'them', 'their', 'what', 'when', 'where', 'how', 'why', 'which', 'who', 'not', 'no', 'so', 'if', 'then', 'than', 'into', 'about', 'up', 'out', 'use', 'using', 'used'])
  return text
    .replace(/[^a-zA-Z\s]/g, ' ')
    .split(/\s+/)
    .map(w => w.toLowerCase().trim())
    .filter(w => w.length > 3 && !stopWords.has(w))
}

// Self-assess a written answer against keywords from manual note + task text
function selfAssess(answer: string, manualNote: string, taskText: string): { hits: string[]; misses: string[]; score: number } {
  const answerLower = answer.toLowerCase()
  const keywords = [...new Set([...extractKeywords(manualNote), ...extractKeywords(taskText)])]
  const hits = keywords.filter(k => answerLower.includes(k))
  const misses = keywords.filter(k => !answerLower.includes(k)).slice(0, 4)
  const score = keywords.length > 0 ? Math.min(100, Math.round((hits.length / Math.max(keywords.length, 1)) * 100)) : 0
  return { hits: hits.slice(0, 6), misses, score }
}

interface ManualPopup {
  ref: string
  note: string
  pageRef: string
}

// Render task text with §X.X references as tappable chips
function renderWithSectionLinks(text: string, onSection: (match: string) => void) {
  const parts = text.split(/(§[\d.]+(?:\s*\([^)]+\))?)/g)
  return parts.map((part, i) => {
    if (/^§/.test(part)) {
      return (
        <button key={i} type="button" onClick={() => onSection(part)}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-bold text-xs align-baseline mx-0.5 transition-all active:scale-95"
          style={{ background: 'rgba(232,197,71,0.15)', color: '#e8c547', border: '1px solid rgba(232,197,71,0.35)', lineHeight: 1.4 }}>
          {part} ↗
        </button>
      )
    }
    return <span key={i}>{part}</span>
  })
}

export default function StageView({ stageIdx, userId, tasks, dayData, remarks, signoffs, unreadCount }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const stage = STAGES[stageIdx]
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set())
  const [localTasks, setLocalTasks] = useState<TaskProgress[]>(tasks)
  const [localDayData, setLocalDayData] = useState<DayData[]>(dayData)
  const [assessments, setAssessments] = useState<Record<string, { hits: string[]; misses: string[]; score: number }>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [manualPopup, setManualPopup] = useState<ManualPopup | null>(null)
  const [manualExpanded, setManualExpanded] = useState<Set<number>>(new Set())

  async function expandManual(di: number) {
    setManualExpanded(prev => { const n = new Set(prev); n.add(di); return n })
    const dd = getDayData(di)
    if (!dd?.manual_read_at) {
      const now = new Date().toISOString()
      setLocalDayData(prev => {
        const idx = prev.findIndex(d => d.stage_idx === stageIdx && d.day_idx === di)
        if (idx >= 0) { const n = [...prev]; n[idx] = { ...n[idx], manual_read_at: now }; return n }
        return [...prev, { id: `temp-${di}`, student_id: userId, stage_idx: stageIdx, day_idx: di, reflection: null, video_url: null, opened_at: null, manual_read_at: now }]
      })
      await supabase.from('day_data').upsert(
        { student_id: userId, stage_idx: stageIdx, day_idx: di, manual_read_at: now },
        { onConflict: 'student_id,stage_idx,day_idx' }
      )
    }
  }

  const colour = stage.colour
  const signoff = signoffs.find(s => s.stage_idx === stageIdx)

  function getTask(di: number, ti: number) {
    return localTasks.find(t => t.stage_idx === stageIdx && t.day_idx === di && t.task_idx === ti)
  }

  function getDayData(di: number) {
    return localDayData.find(d => d.stage_idx === stageIdx && d.day_idx === di)
  }

  function getTaskCount(di: number) {
    return localTasks.filter(t => t.stage_idx === stageIdx && t.day_idx === di && t.completed).length
  }

  function overallPct() {
    const total = stage.days.reduce((a, d) => a + d.tasks.length, 0)
    const done = localTasks.filter(t => t.stage_idx === stageIdx && t.completed).length
    return total ? Math.round(done / total * 100) : 0
  }

  async function submitAnswer(di: number, ti: number, answer: string) {
    if (!answer.trim()) return
    const key = `${di}-${ti}`
    setSaving(key)

    const day = stage.days[di]
    const task = day.tasks[ti]
    const result = selfAssess(answer, day.manualNote, task.text)
    setAssessments(prev => ({ ...prev, [key]: result }))

    setLocalTasks(prev => {
      const idx = prev.findIndex(t => t.stage_idx === stageIdx && t.day_idx === di && t.task_idx === ti)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], completed: true, answer, score: result.score, completed_at: new Date().toISOString() }
        return next
      }
      return [...prev, { id: `temp-${di}-${ti}`, student_id: userId, stage_idx: stageIdx, day_idx: di, task_idx: ti, completed: true, completed_at: new Date().toISOString(), answer, score: result.score }]
    })

    await supabase.from('task_progress').upsert({
      student_id: userId, stage_idx: stageIdx, day_idx: di, task_idx: ti,
      completed: true, completed_at: new Date().toISOString(), answer, score: result.score,
    }, { onConflict: 'student_id,stage_idx,day_idx,task_idx' })

    setSaving(null)
  }

  async function toggleCheckbox(di: number, ti: number) {
    const existing = getTask(di, ti)
    const newCompleted = !existing?.completed
    setLocalTasks(prev => {
      const idx = prev.findIndex(t => t.stage_idx === stageIdx && t.day_idx === di && t.task_idx === ti)
      if (idx >= 0) {
        const next = [...prev]; next[idx] = { ...next[idx], completed: newCompleted }; return next
      }
      return [...prev, { id: `temp-${di}-${ti}`, student_id: userId, stage_idx: stageIdx, day_idx: di, task_idx: ti, completed: true, completed_at: null, answer: null, score: null }]
    })
    await supabase.from('task_progress').upsert({
      student_id: userId, stage_idx: stageIdx, day_idx: di, task_idx: ti,
      completed: newCompleted, completed_at: newCompleted ? new Date().toISOString() : null,
    }, { onConflict: 'student_id,stage_idx,day_idx,task_idx' })
  }

  async function toggleDay(di: number) {
    const isOpen = expandedDays.has(di)
    setExpandedDays(prev => { const n = new Set(prev); if (isOpen) n.delete(di); else n.add(di); return n })
    if (!isOpen && !getDayData(di)?.opened_at) {
      const now = new Date().toISOString()
      setLocalDayData(prev => {
        const idx = prev.findIndex(d => d.stage_idx === stageIdx && d.day_idx === di)
        if (idx >= 0) { const n = [...prev]; n[idx] = { ...n[idx], opened_at: now }; return n }
        return [...prev, { id: `temp-${di}`, student_id: userId, stage_idx: stageIdx, day_idx: di, reflection: null, video_url: null, opened_at: now, manual_read_at: null }]
      })
      await supabase.from('day_data').upsert({ student_id: userId, stage_idx: stageIdx, day_idx: di, opened_at: now }, { onConflict: 'student_id,stage_idx,day_idx' })
    }
  }

  async function saveField(di: number, field: 'reflection' | 'video_url', value: string) {
    await supabase.from('day_data').upsert(
      { student_id: userId, stage_idx: stageIdx, day_idx: di, [field]: value },
      { onConflict: 'student_id,stage_idx,day_idx' }
    )
  }

  return (
    <div style={{ background: '#080810', minHeight: '100vh', paddingBottom: 80 }}>
      <Topbar progress={overallPct()} mode="student" />

      <div style={{ maxWidth: 480, margin: '0 auto' }}>

        {/* Back */}
        <button onClick={() => router.push('/pathway')} className="flex items-center gap-2 px-4 py-3 text-sm w-full" style={{ color: '#7070a0', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <span style={{ color: '#f0f0eb', fontSize: 18 }}>←</span> All Stages
        </button>

        {/* Stage hero */}
        <div className="px-4 py-5" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: '#7070a0' }}>{stage.eyebrow}</div>
          <div className="font-display whitespace-pre-line leading-none" style={{ fontSize: 56, color: colour, letterSpacing: '0.02em' }}>{stage.name}</div>
          <p className="text-sm mt-2 leading-relaxed" style={{ color: '#7070a0' }}>{stage.desc}</p>
          <span className="inline-block mt-2 text-xs font-bold px-3 py-1 rounded" style={{ background: 'rgba(232,197,71,0.08)', color: '#e8c547', border: '1px solid rgba(232,197,71,0.2)' }}>{stage.ref}</span>
        </div>

        {/* Competency gate */}
        {stageIdx > 0 && (
          <div className="mx-4 mt-3 px-4 py-3 rounded-xl text-sm font-medium"
            style={signoffs.some(s => s.stage_idx === stageIdx - 1)
              ? { border: '1px solid rgba(46,204,113,0.3)', background: 'rgba(46,204,113,0.07)', color: '#2ecc71' }
              : { border: '1px solid rgba(255,255,255,0.08)', background: '#111120', color: '#7070a0' }}>
            {signoffs.some(s => s.stage_idx === stageIdx - 1)
              ? `✓ Stage ${stageIdx} complete — unlocked`
              : `Stage ${stageIdx} in progress — coach sign-off required to unlock`}
          </div>
        )}

        {/* Day list */}
        <div className="flex flex-col gap-2 px-4 mt-3">
          {stage.days.map((day, di) => {
            const isOpen = expandedDays.has(di)
            const taskCount = getTaskCount(di)
            const allDone = taskCount === day.tasks.length
            const dd = getDayData(di)
            const remark = remarks.find(r => r.day_idx === di)
            const isLastDay = di === 9
            const coachSigned = isLastDay && !!signoff

            return (
              <div key={di} className="rounded-2xl overflow-hidden" style={{ background: '#111120', border: `1px solid ${allDone ? 'rgba(46,204,113,0.3)' : 'rgba(255,255,255,0.07)'}` }}>

                {/* Day header */}
                <button onClick={() => toggleDay(di)} className="flex items-center gap-3 w-full px-4 py-4 text-left" style={{ minHeight: 60 }}>
                  <div className="font-display text-3xl leading-none flex-shrink-0 w-10 text-center" style={{ color: colour }}>
                    {String(stageIdx * 10 + di + 1).padStart(2, '0')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-semibold truncate">{day.title}</div>
                    <div className="text-xs uppercase tracking-widest mt-0.5" style={{ color: '#7070a0' }}>
                      {day.focus} · {taskCount}/{day.tasks.length} tasks
                    </div>
                  </div>
                  <div className="w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs flex-shrink-0 transition-all"
                    style={allDone ? { background: '#2ecc71', borderColor: '#2ecc71', color: '#080810', fontWeight: 700 } : { borderColor: 'rgba(255,255,255,0.07)' }}>
                    {allDone ? '✓' : ''}
                  </div>
                  <span style={{ color: '#7070a0', fontSize: 16, transform: isOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }}>▾</span>
                </button>

                {isOpen && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>

                    {/* Manual reference — tap to expand, logs read silently */}
                    <div className="mx-4 mt-4">
                      <button
                        onClick={() => manualExpanded.has(di) ? setManualExpanded(prev => { const n = new Set(prev); n.delete(di); return n }) : expandManual(di)}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all"
                        style={{ background: '#0c0c18', border: `1px solid ${manualExpanded.has(di) ? 'rgba(232,197,71,0.4)' : 'rgba(232,197,71,0.15)'}`, borderLeft: '3px solid #e8c547' }}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#e8c547' }}>📖 Manual Reference</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-widest" style={{ background: 'rgba(232,197,71,0.1)', color: '#e8c547' }}>{day.manualNote.match(/§[\d.]+(?:\s*\([^)]+\))?/)?.[0] ?? stage.ref}</span>
                        </div>
                        <span style={{ color: '#e8c547', fontSize: 14, transform: manualExpanded.has(di) ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }}>▾</span>
                      </button>
                      {manualExpanded.has(di) && (
                        <div className="px-4 py-3 rounded-b-xl" style={{ background: '#0a0a18', borderLeft: '3px solid #e8c547', borderRight: '1px solid rgba(232,197,71,0.15)', borderBottom: '1px solid rgba(232,197,71,0.15)' }}>
                          <p className="text-sm leading-relaxed" style={{ color: '#c0c0d8' }}>{day.manualNote}</p>
                        </div>
                      )}
                    </div>

                    {/* Coach remark */}
                    {remark && (
                      <div className="mx-4 mt-3 px-4 py-3 rounded-xl" style={{ background: 'rgba(232,197,71,0.06)', border: '1px solid rgba(232,197,71,0.2)' }}>
                        <div className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: '#e8c547' }}>Coach Note</div>
                        <div className="text-sm leading-relaxed">{remark.remark}</div>
                      </div>
                    )}

                    {/* Tasks */}
                    <div className="px-4 pt-4">
                      <div className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#7070a0' }}>Tasks</div>
                      <div className="flex flex-col gap-4">
                        {day.tasks.map((task, ti) => {
                          const prog = getTask(di, ti)
                          const done = prog?.completed ?? false
                          const written = isWrittenTask(task.text)
                          const key = `${di}-${ti}`
                          const assessment = assessments[key]
                          const savedAnswer = prog?.answer ?? ''

                          return (
                            <div key={ti} className="rounded-xl overflow-hidden" style={{ background: '#0c0c18', border: `1px solid ${done ? 'rgba(46,204,113,0.25)' : 'rgba(255,255,255,0.07)'}` }}>
                              <div className="p-4">
                                {/* Task number + type badge */}
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="font-display text-xl leading-none" style={{ color: done ? '#2ecc71' : colour }}>{String(ti + 1).padStart(2, '0')}</span>
                                  <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded"
                                    style={written
                                      ? { background: 'rgba(78,205,196,0.12)', color: '#4ecdc4', border: '1px solid rgba(78,205,196,0.25)' }
                                      : { background: 'rgba(255,255,255,0.05)', color: '#7070a0', border: '1px solid rgba(255,255,255,0.07)' }}>
                                    {written ? '✍ Written' : '✓ Practical'}
                                  </span>
                                  {done && <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ml-auto" style={{ background: 'rgba(46,204,113,0.1)', color: '#2ecc71', border: '1px solid rgba(46,204,113,0.25)' }}>Done</span>}
                                </div>

                                {/* Task text */}
                                <p className="text-sm leading-relaxed mb-1" style={{ color: done ? '#7070a0' : '#f0f0eb' }}>
                                  {renderWithSectionLinks(task.text, () => setManualPopup({ ref: task.ref, note: day.manualNote, pageRef: task.ref }))}
                                </p>
                                <div className="text-xs font-bold" style={{ color: '#4a4a70' }}>{task.ref}</div>
                              </div>

                              {written ? (
                                <div className="px-4 pb-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                                  {/* Show saved answer if done */}
                                  {done && savedAnswer ? (
                                    <div className="mt-3">
                                      <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#7070a0' }}>Your answer</div>
                                      <div className="text-sm leading-relaxed px-3 py-3 rounded-xl italic" style={{ background: '#111120', color: '#f0f0eb', borderLeft: '2px solid #2ecc71' }}>{savedAnswer}</div>
                                    </div>
                                  ) : (
                                    <div className="mt-3">
                                      <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#7070a0' }}>Your answer</div>
                                      <textarea
                                        id={`answer-${key}`}
                                        className="inp"
                                        placeholder="Write your answer here…"
                                        defaultValue={savedAnswer}
                                        style={{ minHeight: 90, fontSize: 14 }}
                                      />
                                      <button
                                        onClick={() => {
                                          const el = document.getElementById(`answer-${key}`) as HTMLTextAreaElement
                                          if (el?.value.trim()) submitAnswer(di, ti, el.value.trim())
                                        }}
                                        disabled={saving === key}
                                        className="w-full mt-2 py-3 rounded-xl font-display text-xl tracking-wide disabled:opacity-40"
                                        style={{ background: '#4ecdc4', color: '#080810', letterSpacing: '0.04em' }}>
                                        {saving === key ? 'CHECKING…' : 'SUBMIT ANSWER'}
                                      </button>
                                    </div>
                                  )}

                                  {/* Self-assessment result */}
                                  {assessment && (
                                    <div className="mt-3 rounded-xl p-4" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.07)' }}>
                                      <div className="flex items-center justify-between mb-3">
                                        <div className="text-xs font-bold uppercase tracking-widest" style={{ color: '#7070a0' }}>Self-Assessment</div>
                                        <div className="font-display text-2xl" style={{ color: assessment.score >= 60 ? '#2ecc71' : assessment.score >= 30 ? '#e8c547' : '#ff6b9d' }}>
                                          {assessment.score}%
                                        </div>
                                      </div>
                                      {assessment.hits.length > 0 && (
                                        <div className="mb-2">
                                          <div className="text-xs font-bold mb-1" style={{ color: '#2ecc71' }}>✓ You covered</div>
                                          <div className="flex flex-wrap gap-1">
                                            {assessment.hits.map(k => (
                                              <span key={k} className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(46,204,113,0.1)', color: '#2ecc71', border: '1px solid rgba(46,204,113,0.2)' }}>{k}</span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      {assessment.misses.length > 0 && (
                                        <div>
                                          <div className="text-xs font-bold mb-1" style={{ color: '#e8c547' }}>→ Also consider</div>
                                          <div className="flex flex-wrap gap-1">
                                            {assessment.misses.map(k => (
                                              <span key={k} className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(232,197,71,0.08)', color: '#e8c547', border: '1px solid rgba(232,197,71,0.2)' }}>{k}</span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      <p className="text-xs mt-3 leading-relaxed" style={{ color: '#7070a0' }}>
                                        {assessment.score >= 60 ? 'Strong answer — your coach can see this.' : assessment.score >= 30 ? 'Good start — review the manual section and consider the terms above.' : 'Go back to the manual reference and try again when ready.'}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              ) : (
                                /* Practical task — tap to mark done */
                                <div className="px-4 pb-4" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                                  <button
                                    onClick={() => toggleCheckbox(di, ti)}
                                    className="w-full mt-3 py-3 rounded-xl font-display text-xl tracking-wide transition-all"
                                    style={done
                                      ? { background: 'rgba(46,204,113,0.1)', border: '1px solid rgba(46,204,113,0.3)', color: '#2ecc71', letterSpacing: '0.04em' }
                                      : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: '#7070a0', letterSpacing: '0.04em' }}>
                                    {done ? '✓ DONE' : 'MARK DONE'}
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Day inputs */}
                    <div className="px-4 mt-4 pb-4">
                      <div className="text-xs font-bold uppercase tracking-widest mb-2 mt-2" style={{ color: '#7070a0' }}>Video Link (optional)</div>
                      <input type="url" className="inp" placeholder="https://youtube.com/..." defaultValue={dd?.video_url ?? ''} onBlur={e => saveField(di, 'video_url', e.target.value)} />

                      <div className="text-xs font-bold uppercase tracking-widest mb-2 mt-3" style={{ color: '#7070a0' }}>Overall Reflection for this day</div>
                      <textarea className="inp" placeholder="What did you notice? What clicked? What felt hard?" defaultValue={dd?.reflection ?? ''} onBlur={e => saveField(di, 'reflection', e.target.value)} />

                      <button onClick={() => router.push(`/pathway/chat?stage=${stageIdx}&day=${di}`)}
                        className="flex items-center gap-2 w-full mt-3 px-4 py-3 rounded-xl transition-all"
                        style={{ background: 'rgba(232,197,71,0.06)', border: '1px solid rgba(232,197,71,0.2)', minHeight: 48 }}>
                        <span style={{ color: '#e8c547' }}>💬</span>
                        <span className="text-sm font-bold" style={{ color: '#e8c547' }}>Ask your coach about this day</span>
                      </button>

                      {isLastDay && (
                        <div className="mt-3 px-4 py-3 rounded-xl text-sm font-medium"
                          style={coachSigned
                            ? { border: '1px solid rgba(46,204,113,0.3)', background: 'rgba(46,204,113,0.07)', color: '#2ecc71' }
                            : { border: '1px solid rgba(255,255,255,0.07)', background: '#0c0c18', color: '#7070a0' }}>
                          {coachSigned ? `✓ Stage ${stageIdx + 1} signed off by your coach` : 'Awaiting coach sign-off to unlock the next stage'}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Manual section popup */}
      {manualPopup && (
        <div className="fixed inset-0 z-[300] flex items-end" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setManualPopup(null)}>
          <div className="w-full rounded-t-3xl p-6 pb-10" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.07)', maxHeight: '70vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            {/* Handle */}
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: 'rgba(255,255,255,0.07)' }} />
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#4a4a70' }}>Manual Reference</div>
                <div className="font-display text-2xl leading-none" style={{ color: '#e8c547', letterSpacing: '0.04em' }}>{manualPopup.ref}</div>
              </div>
              <button onClick={() => setManualPopup(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
                style={{ background: 'rgba(255,255,255,0.07)', color: '#7070a0' }}>✕</button>
            </div>
            <div className="rounded-2xl p-4" style={{ background: '#0c0c18', borderLeft: '3px solid #e8c547' }}>
              <p className="text-sm leading-relaxed" style={{ color: '#f0f0eb' }}>{manualPopup.note}</p>
            </div>
            <p className="text-xs mt-4 text-center" style={{ color: '#3a3a5c' }}>Open your physical manual to {manualPopup.pageRef}</p>
          </div>
        </div>
      )}

      {/* Floating chat */}
      <button onClick={() => router.push('/pathway/chat')} className="fixed bottom-20 right-4 w-14 h-14 rounded-full flex items-center justify-center"
        style={{ background: '#e8c547', boxShadow: '0 4px 20px rgba(232,197,71,0.35)', zIndex: 200 }}>
        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="#080810" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: '#ff6b9d', color: '#fff' }}>
            {unreadCount}
          </span>
        )}
      </button>

      <BottomNav unreadCoach={unreadCount} />
    </div>
  )
}
