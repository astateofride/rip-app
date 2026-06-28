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
  previewMode?: boolean
  onBack?: () => void
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
  // Cap pool at 10 so scoring reflects the concepts actually shown, not every word extracted
  const keywords = [...new Set([...extractKeywords(manualNote), ...extractKeywords(taskText)])].slice(0, 10)
  const hits = keywords.filter(k => answerLower.includes(k))
  const misses = keywords.filter(k => !answerLower.includes(k)).slice(0, 4)
  const score = keywords.length > 0 ? Math.min(100, Math.round((hits.length / keywords.length) * 100)) : 0
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

export default function StageView({ stageIdx, userId, tasks, dayData, remarks, signoffs, unreadCount, previewMode, onBack }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const stage = STAGES[stageIdx]
  const [localTasks, setLocalTasks] = useState<TaskProgress[]>(tasks)
  const [localDayData, setLocalDayData] = useState<DayData[]>(dayData)
  const [assessments, setAssessments] = useState<Record<string, { hits: string[]; misses: string[]; score: number }>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [manualPopup, setManualPopup] = useState<ManualPopup | null>(null)
  const [manualExpanded, setManualExpanded] = useState<Set<number>>(new Set())
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const flatTasks = stage.days.flatMap((day, di) => day.tasks.map((task, ti) => ({ di, ti, task, day })))
  const [activeTaskFlat, setActiveTaskFlat] = useState(() => {
    for (let i = 0; i < flatTasks.length; i++) {
      const { di, ti } = flatTasks[i]
      if (!tasks.find(t => t.stage_idx === stageIdx && t.day_idx === di && t.task_idx === ti)?.completed) return i
    }
    return flatTasks.length - 1
  })
  const [coachPrompt, setCoachPrompt] = useState<{ di: number; done: number; total: number } | null>(null)
  const [promptDismissed, setPromptDismissed] = useState<Set<number>>(new Set())
  const [pingSending, setPingSending] = useState(false)
  const [pingSent, setPingSent] = useState(false)

  function checkPrompt(di: number, updatedTasks: typeof localTasks) {
    if (promptDismissed.has(di)) return
    const total = stage.days[di].tasks.length
    const done = updatedTasks.filter(t => t.stage_idx === stageIdx && t.day_idx === di && t.completed).length
    if (done > 0 && done < total) {
      setCoachPrompt({ di, done, total })
    } else {
      setCoachPrompt(null)
    }
  }

  async function pingCoach(di: number, done: number, total: number) {
    setPingSending(true)
    const dayNum = stageIdx * 10 + di + 1
    const dayTitle = stage.days[di].title
    const text = `Hey! Just knocked out ${done} of ${total} tasks in Stage ${stageIdx + 1}, Day ${dayNum} — "${dayTitle}". Happy for you to take a look when you can 👊`
    await supabase.from('messages').insert({
      student_id: userId,
      sender_id: userId,
      from_role: 'student',
      text,
      stage_ref: stageIdx,
      day_ref: di,
    })
    setPingSending(false)
    setPingSent(true)
    setTimeout(() => {
      setCoachPrompt(null)
      setPromptDismissed(prev => { const n = new Set(prev); n.add(di); return n })
      setPingSent(false)
    }, 1800)
  }

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
    // compute updated list to check prompt without relying on async state
    const nextTasks = (() => {
      const idx = localTasks.findIndex(t => t.stage_idx === stageIdx && t.day_idx === di && t.task_idx === ti)
      if (idx >= 0) {
        const n = [...localTasks]; n[idx] = { ...n[idx], completed: true, answer, score: result.score }; return n
      }
      return [...localTasks, { id: `temp-${di}-${ti}`, student_id: userId, stage_idx: stageIdx, day_idx: di, task_idx: ti, completed: true, completed_at: new Date().toISOString(), answer, score: result.score }]
    })()
    checkPrompt(di, nextTasks)
  }

  async function toggleCheckbox(di: number, ti: number) {
    const existing = getTask(di, ti)
    const newCompleted = !existing?.completed
    let updated: typeof localTasks = []
    setLocalTasks(prev => {
      const idx = prev.findIndex(t => t.stage_idx === stageIdx && t.day_idx === di && t.task_idx === ti)
      if (idx >= 0) {
        const next = [...prev]; next[idx] = { ...next[idx], completed: newCompleted }; updated = next; return next
      }
      const next = [...prev, { id: `temp-${di}-${ti}`, student_id: userId, stage_idx: stageIdx, day_idx: di, task_idx: ti, completed: newCompleted, completed_at: newCompleted ? new Date().toISOString() : null, answer: null, score: null }]
      updated = next; return next
    })
    await supabase.from('task_progress').upsert({
      student_id: userId, stage_idx: stageIdx, day_idx: di, task_idx: ti,
      completed: newCompleted, completed_at: newCompleted ? new Date().toISOString() : null,
    }, { onConflict: 'student_id,stage_idx,day_idx,task_idx' })
    checkPrompt(di, updated)
  }

  async function saveField(di: number, field: 'reflection' | 'video_url', value: string) {
    await supabase.from('day_data').upsert(
      { student_id: userId, stage_idx: stageIdx, day_idx: di, [field]: value },
      { onConflict: 'student_id,stage_idx,day_idx' }
    )
  }

  function goNextTask() {
    let next = activeTaskFlat + 1
    while (next < flatTasks.length) {
      const { di: ndi, ti: nti } = flatTasks[next]
      if (!localTasks.find(t => t.stage_idx === stageIdx && t.day_idx === ndi && t.task_idx === nti)?.completed) {
        setActiveTaskFlat(next)
        return
      }
      next++
    }
    if (activeTaskFlat < flatTasks.length - 1) setActiveTaskFlat(activeTaskFlat + 1)
  }

  const currentFlat = flatTasks[activeTaskFlat] ?? flatTasks[flatTasks.length - 1]
  const { di, ti: activeTi, task: activeTask, day } = currentFlat
  const dayNum = stageIdx * 10 + di + 1
  const taskCount = getTaskCount(di)
  const allDayTasksDone = taskCount === day.tasks.length
  const dd = getDayData(di)
  const remark = remarks.find(r => r.stage_idx === stageIdx && r.day_idx === di)
  const isLastDay = di === stage.days.length - 1
  const isFirstTaskInDay = activeTaskFlat === 0 || flatTasks[activeTaskFlat - 1]?.di !== di
  const allStageDone = localTasks.filter(t => t.stage_idx === stageIdx && t.completed).length === flatTasks.length

  const prog = getTask(di, activeTi)
  const taskDone = prog?.completed ?? false
  const written = isWrittenTask(activeTask.text)
  const taskKey = `${di}-${activeTi}`
  const assessment = assessments[taskKey]
  const savedAnswer = prog?.answer ?? ''
  const isExpandedForResubmit = expandedTasks.has(taskKey)

  return (
    <div style={{ background: '#080810', minHeight: '100dvh', paddingBottom: 100 }}>
      <Topbar progress={overallPct()} mode="student" />

      {/* STAGE HEADER */}
      <div style={{ background: '#080810', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center gap-3 px-4 py-3" style={{ maxWidth: 480, margin: '0 auto' }}>
          <button onClick={() => onBack ? onBack() : router.push('/pathway')}
            style={{ color: '#9898c0', minWidth: 36, minHeight: 36, display: 'flex', alignItems: 'center', background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>←</button>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#9898c0' }}>{stage.eyebrow}</div>
            <div className="font-display leading-none" style={{ fontSize: 20, color: colour, letterSpacing: '0.04em' }}>{stage.name}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="font-display text-xl" style={{ color: overallPct() === 100 ? '#2ecc71' : colour }}>{overallPct()}%</div>
            <div className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#9898c0' }}>
              {localTasks.filter(t => t.stage_idx === stageIdx && t.completed).length}/{stage.days.reduce((a, d) => a + d.tasks.length, 0)} tasks
            </div>
          </div>
        </div>
        <div style={{ height: 3, background: '#111120' }}>
          <div style={{ height: '100%', width: `${overallPct()}%`, background: colour, transition: 'width 0.5s ease' }} />
        </div>
      </div>

      {/* TASK PROGRESS — dots strip */}
      <div className="px-4 py-3" style={{ maxWidth: 480, margin: '0 auto' }}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#9898c0' }}>
            Task {activeTaskFlat + 1} / {flatTasks.length}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-widest ml-auto" style={{ color: colour }}>
            {day.title}
          </span>
        </div>
        <div className="relative h-2 rounded-full overflow-hidden" style={{ background: '#1a1a2e' }}>
          {/* completed portion */}
          <div className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
            style={{ width: `${Math.round((flatTasks.filter(({ di: fdi, ti: fti }) => !!localTasks.find(t => t.stage_idx === stageIdx && t.day_idx === fdi && t.task_idx === fti)?.completed).length / flatTasks.length) * 100)}%`, background: '#2ecc71' }} />
          {/* active position marker */}
          <div className="absolute inset-y-0 rounded-full transition-all duration-300"
            style={{ left: `${(activeTaskFlat / flatTasks.length) * 100}%`, width: `${(1 / flatTasks.length) * 100}%`, background: colour, opacity: 0.9 }} />
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ maxWidth: 480, margin: '0 auto' }}>

        {/* Coach remark for this day */}
        {remark && (
          <div className="mx-4 mb-3 px-4 py-3 rounded-2xl" style={{ background: 'rgba(232,197,71,0.05)', borderLeft: `3px solid ${colour}` }}>
            <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: colour }}>Your Coach Says</div>
            <div className="text-sm leading-relaxed" style={{ color: '#f0f0eb' }}>{remark.remark}</div>
          </div>
        )}

        {/* Manual reference — shown when entering a new day */}
        {isFirstTaskInDay && (
          <div className="mx-4 mb-4">
            <button
              onClick={() => manualExpanded.has(di) ? setManualExpanded(prev => { const n = new Set(prev); n.delete(di); return n }) : expandManual(di)}
              className="w-full flex items-center justify-between px-4 py-3.5 rounded-2xl transition-all active:scale-[0.98]"
              style={{
                background: manualExpanded.has(di) ? '#0a0a18' : 'rgba(232,197,71,0.05)',
                border: `2px solid ${manualExpanded.has(di) ? '#e8c547' : dd?.manual_read_at ? 'rgba(232,197,71,0.25)' : 'rgba(232,197,71,0.55)'}`,
                boxShadow: !dd?.manual_read_at && !manualExpanded.has(di) ? '0 0 18px rgba(232,197,71,0.1)' : undefined,
              }}>
              <div className="flex items-center gap-3">
                <span style={{ fontSize: 22 }}>📖</span>
                <div className="text-left">
                  <div className="text-sm font-bold uppercase tracking-widest" style={{ color: '#e8c547' }}>
                    {dd?.manual_read_at ? 'Manual Reference' : 'Read This First'}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: '#9898c0' }}>{day.manualNote.match(/§[\d.]+(?:\s*\([^)]+\))?/)?.[0] ?? stage.ref}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {dd?.manual_read_at && <span className="text-[9px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(46,204,113,0.1)', color: '#2ecc71' }}>READ ✓</span>}
                <span style={{ color: '#e8c547', fontSize: 14, transform: manualExpanded.has(di) ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }}>▾</span>
              </div>
            </button>
            {manualExpanded.has(di) && (
              <div className="px-5 py-4 rounded-b-2xl -mt-2" style={{ background: '#0a0a18', border: '2px solid #e8c547', borderTop: 'none' }}>
                <p className="text-sm leading-relaxed" style={{ color: '#d4d4ea' }}>{day.manualNote}</p>
              </div>
            )}
          </div>
        )}

        {/* CURRENT TASK */}
        <div className="px-4 mb-4">
          {taskDone && !isExpandedForResubmit ? (
            /* Completed — show summary + NEXT TASK */
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 px-4 py-3.5 rounded-2xl"
                style={{ background: 'rgba(46,204,113,0.06)', border: '1px solid rgba(46,204,113,0.2)' }}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 font-bold" style={{ background: '#2ecc71', color: '#080810' }}>✓</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm leading-snug" style={{ color: '#c0c0d8' }}>{activeTask.text}</p>
                  {written && prog?.score !== null && (
                    <div className="text-[10px] mt-1 font-bold" style={{ color: (prog?.score ?? 0) >= 60 ? '#2ecc71' : '#e8c547' }}>
                      Score: {prog?.score}% {(prog?.score ?? 0) >= 60 ? '✓' : '— tap to improve'}
                    </div>
                  )}
                </div>
                {written && (
                  <button onClick={() => setExpandedTasks(prev => { const n = new Set(prev); n.add(taskKey); return n })}
                    className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded flex-shrink-0"
                    style={{ color: '#9898c0', background: 'rgba(255,255,255,0.05)' }}>edit</button>
                )}
              </div>
              {activeTaskFlat < flatTasks.length - 1 && (
                <button onClick={goNextTask}
                  className="w-full py-5 rounded-2xl font-display text-2xl tracking-wide active:scale-[0.98] transition-all"
                  style={{ background: colour, color: '#080810', letterSpacing: '0.05em' }}>
                  NEXT TASK →
                </button>
              )}
            </div>
          ) : taskDone && isExpandedForResubmit ? (
            /* Resubmit written answer */
            <div className="rounded-2xl overflow-hidden" style={{ background: '#111120', border: '1px solid rgba(46,204,113,0.3)' }}>
              <div className="flex items-center gap-2 px-4 pt-4 pb-2">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: '#2ecc71', color: '#080810' }}>✓</div>
                <p className="text-sm flex-1 leading-snug" style={{ color: '#9898c0' }}>{activeTask.text}</p>
                <button onClick={() => setExpandedTasks(prev => { const n = new Set(prev); n.delete(taskKey); return n })}
                  className="text-xs px-2 py-1 rounded flex-shrink-0" style={{ color: '#9898c0', background: 'rgba(255,255,255,0.05)' }}>▲</button>
              </div>
              <div className="px-4 pb-4">
                {(assessment ? assessment.score < 60 : (prog?.score ?? 100) < 60) && (
                  <div className="mb-3 px-4 py-3 rounded-xl" style={{ background: 'rgba(232,197,71,0.06)', border: '1px solid rgba(232,197,71,0.2)' }}>
                    <div className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: '#e8c547' }}>💬 Coach says</div>
                    <p className="text-sm leading-relaxed" style={{ color: '#f0f0eb' }}>
                      {(() => {
                        const sc = assessment?.score ?? prog?.score ?? 0
                        const hint = assessment?.misses?.[0] ?? null
                        return sc < 30
                          ? `Good attempt — let's build on this. Can you write a bit more${hint ? ` and try to explain "${hint}" in your own words` : ''}?`
                          : `You're on the right track! Can you expand your answer a little? ${hint ? `Try to say a bit more about "${hint}" —` : 'Even'} one extra sentence makes a difference.`
                      })()}
                    </p>
                  </div>
                )}
                <textarea key={`answer-${taskKey}-${savedAnswer}`} id={`answer-${taskKey}`} className="inp" defaultValue={savedAnswer} style={{ minHeight: 100, fontSize: 15 }} />
                <button onClick={() => { const el = document.getElementById(`answer-${taskKey}`) as HTMLTextAreaElement; if (el?.value.trim()) submitAnswer(di, activeTi, el.value.trim()) }}
                  disabled={saving === taskKey}
                  className="w-full mt-2 py-3 rounded-xl font-display text-xl tracking-wide disabled:opacity-40 active:scale-[0.98] transition-all"
                  style={{ background: '#4ecdc4', color: '#080810', letterSpacing: '0.04em' }}>
                  {saving === taskKey ? 'CHECKING…' : 'RESUBMIT ANSWER'}
                </button>
                {assessment && (
                  <div className="mt-3 rounded-xl p-3" style={{ background: '#0c0c18', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-bold uppercase tracking-widest" style={{ color: '#9898c0' }}>Self-Assessment</div>
                      <div className="font-display text-xl" style={{ color: assessment.score >= 60 ? '#2ecc71' : assessment.score >= 40 ? '#e8c547' : '#ff6b9d' }}>{assessment.score}%</div>
                    </div>
                    {assessment.hits.length > 0 && <div className="flex flex-wrap gap-1 mb-1">{assessment.hits.map(k => <span key={k} className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(46,204,113,0.1)', color: '#2ecc71', border: '1px solid rgba(46,204,113,0.2)' }}>{k}</span>)}</div>}
                    {assessment.misses.length > 0 && <div className="flex flex-wrap gap-1">{assessment.misses.map(k => <span key={k} className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(232,197,71,0.08)', color: '#e8c547', border: '1px solid rgba(232,197,71,0.2)' }}>{k}</span>)}</div>}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Active task — YOUR TURN */
            <div className="rounded-2xl overflow-hidden" style={{ background: '#111120', border: `2px solid ${colour}`, boxShadow: `0 0 28px ${colour}18` }}>
              <div className="px-4 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="text-xs font-bold px-3 py-1 rounded-full" style={{ background: colour, color: '#080810', letterSpacing: '0.08em' }}>YOUR TURN</div>
                  <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded ml-auto flex-shrink-0"
                    style={written
                      ? { background: 'rgba(78,205,196,0.12)', color: '#4ecdc4', border: '1px solid rgba(78,205,196,0.25)' }
                      : { background: 'rgba(255,255,255,0.05)', color: '#9898c0', border: '1px solid rgba(255,255,255,0.07)' }}>
                    {written ? '✍ Written' : '✓ Practical'}
                  </span>
                </div>
                <p className="text-base leading-relaxed font-medium" style={{ color: '#f0f0eb' }}>
                  {renderWithSectionLinks(activeTask.text, () => setManualPopup({ ref: activeTask.ref, note: day.manualNote, pageRef: activeTask.ref }))}
                </p>
                <div className="text-[10px] font-bold mt-1" style={{ color: '#9898c0' }}>{activeTask.ref}</div>
              </div>
              <div className="p-4">
                {written ? (
                  <>
                    <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#9898c0' }}>Your answer</div>
                    <textarea id={`answer-${taskKey}`} className="inp"
                      placeholder="Write your answer here — use your own words…"
                      style={{ minHeight: 100, fontSize: 15 }} />
                    <button
                      onClick={() => { const el = document.getElementById(`answer-${taskKey}`) as HTMLTextAreaElement; if (el?.value.trim()) submitAnswer(di, activeTi, el.value.trim()) }}
                      disabled={saving === taskKey}
                      className="w-full mt-3 py-4 rounded-xl font-display text-2xl tracking-wide disabled:opacity-40 active:scale-[0.98] transition-all"
                      style={{ background: colour, color: '#080810', letterSpacing: '0.05em' }}>
                      {saving === taskKey ? 'CHECKING…' : 'SUBMIT ANSWER →'}
                    </button>
                  </>
                ) : (
                  <button onClick={() => toggleCheckbox(di, activeTi)}
                    className="w-full py-5 rounded-xl font-display text-2xl tracking-wide active:scale-[0.98] transition-all"
                    style={{ background: colour, color: '#080810', letterSpacing: '0.05em' }}>
                    MARK DONE ✓
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Video + reflection — shown when all tasks in the day are done */}
        {allDayTasksDone && (
          <div className="mx-4 mb-5 rounded-2xl overflow-hidden" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="px-4 pt-4 pb-1">
              <div className="font-display text-xl mb-1" style={{ color: '#2ecc71', letterSpacing: '0.04em' }}>DAY {dayNum} DONE ✓</div>
              <p className="text-xs mb-4" style={{ color: '#9898c0' }}>Log your video and reflection before moving on.</p>
            </div>
            <div className="px-4 pb-4 flex flex-col gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#9898c0' }}>Video Link (optional)</div>
                <input type="url" className="inp" placeholder="https://youtube.com/..." defaultValue={dd?.video_url ?? ''} onBlur={e => saveField(di, 'video_url', e.target.value)} style={{ fontSize: 15 }} />
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: '#9898c0' }}>Reflection</div>
                <textarea className="inp" placeholder="What clicked? What felt hard? What surprised you?" defaultValue={dd?.reflection ?? ''} onBlur={e => saveField(di, 'reflection', e.target.value)} style={{ minHeight: 80, fontSize: 15 }} />
              </div>
              {!previewMode && (
                <button onClick={() => router.push(`/pathway/chat?stage=${stageIdx}&day=${di}`)}
                  className="flex items-center gap-2 px-4 py-3 rounded-xl transition-all active:scale-[0.98]"
                  style={{ background: 'rgba(232,197,71,0.06)', border: '1px solid rgba(232,197,71,0.2)' }}>
                  <span style={{ color: '#e8c547' }}>💬</span>
                  <span className="text-sm font-bold" style={{ color: '#e8c547' }}>Ask your coach about this day</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Sign-off status — shown on last task */}
        {isLastDay && activeTaskFlat === flatTasks.length - 1 && (
          <div className="mx-4 mb-5 px-4 py-3 rounded-xl text-sm font-medium"
            style={signoff
              ? { border: '1px solid rgba(46,204,113,0.3)', background: 'rgba(46,204,113,0.07)', color: '#2ecc71' }
              : { border: '1px solid rgba(255,255,255,0.07)', background: '#0c0c18', color: '#9898c0' }}>
            {signoff ? `✓ Stage ${stageIdx + 1} signed off by your coach` : 'Complete all tasks — your coach will sign off to unlock the next stage'}
          </div>
        )}

        {/* All stage done */}
        {allStageDone && !signoff && (
          <div className="mx-4 mb-6 p-5 rounded-2xl text-center" style={{ background: 'rgba(78,205,196,0.05)', border: '1px solid rgba(78,205,196,0.2)' }}>
            <div className="font-display text-3xl mb-1" style={{ color: '#4ecdc4', letterSpacing: '0.05em' }}>STAGE COMPLETE</div>
            <p className="text-sm" style={{ color: '#9898c0' }}>Waiting for your coach to sign off. Keep training!</p>
          </div>
        )}
      </div>

      {/* Manual popup */}
      {manualPopup && (
        <div className="fixed inset-0 z-[300] flex items-end" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setManualPopup(null)}>
          <div className="w-full rounded-t-3xl p-6 pb-10" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.07)', maxHeight: '70vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full mx-auto mb-5" style={{ background: 'rgba(255,255,255,0.07)' }} />
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#9898c0' }}>Manual Reference</div>
                <div className="font-display text-2xl leading-none" style={{ color: '#e8c547', letterSpacing: '0.04em' }}>{manualPopup.ref}</div>
              </div>
              <button onClick={() => setManualPopup(null)} className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold"
                style={{ background: 'rgba(255,255,255,0.07)', color: '#9898c0' }}>✕</button>
            </div>
            <div className="rounded-2xl p-4" style={{ background: '#0c0c18', borderLeft: '3px solid #e8c547' }}>
              <p className="text-sm leading-relaxed" style={{ color: '#f0f0eb' }}>{manualPopup.note}</p>
            </div>
            <p className="text-xs mt-4 text-center" style={{ color: '#8888b0' }}>Open your physical manual to {manualPopup.pageRef}</p>
          </div>
        </div>
      )}

      {/* Coach ping prompt */}
      {coachPrompt && (
        <div className="fixed inset-0 z-[350] flex items-end" style={{ background: 'rgba(0,0,0,0.65)' }}
          onClick={() => { setCoachPrompt(null); setPromptDismissed(prev => { const n = new Set(prev); n.add(coachPrompt.di); return n }) }}>
          <div className="w-full rounded-t-3xl pb-10" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.08)' }}
            onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 rounded-full mx-auto mt-4 mb-5" style={{ background: 'rgba(255,255,255,0.1)' }} />
            <div className="px-6">
              {pingSent ? (
                <div className="flex flex-col items-center py-6 gap-3">
                  <div className="text-4xl">✅</div>
                  <div className="font-display text-2xl text-center" style={{ color: '#2ecc71', letterSpacing: '0.06em' }}>SENT TO YOUR COACH</div>
                  <p className="text-sm text-center" style={{ color: '#9898c0' }}>They'll take a look and get back to you.</p>
                </div>
              ) : (
                <>
                  <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#9898c0' }}>
                    Stage {stageIdx + 1} · Day {stageIdx * 10 + coachPrompt.di + 1}
                  </div>
                  <div className="font-display text-3xl mb-2" style={{ color: '#e8c547', letterSpacing: '0.05em', lineHeight: 1.1 }}>
                    GOOD WORK — KEEP IT GOING!
                  </div>
                  <p className="text-sm leading-relaxed mb-1" style={{ color: '#f0f0eb' }}>
                    You've knocked out <strong style={{ color: '#e8c547' }}>{coachPrompt.done} of {coachPrompt.total}</strong> tasks today. You can keep going now, or ping your coach to check in on where you're at before you push on.
                  </p>
                  <p className="text-xs mb-5" style={{ color: '#9898c0' }}>
                    Want to finish the rest first? No pressure — your progress is saved.
                  </p>
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={() => pingCoach(coachPrompt.di, coachPrompt.done, coachPrompt.total)}
                      disabled={pingSending}
                      className="w-full font-display text-2xl tracking-widest py-4 rounded-2xl active:scale-[0.98] transition-all disabled:opacity-50"
                      style={{ background: '#e8c547', color: '#080810', letterSpacing: '0.06em' }}
                    >
                      {pingSending ? 'SENDING…' : 'PING YOUR COACH →'}
                    </button>
                    <button
                      onClick={() => { setCoachPrompt(null); setPromptDismissed(prev => { const n = new Set(prev); n.add(coachPrompt.di); return n }) }}
                      className="w-full font-display text-xl tracking-widest py-4 rounded-2xl active:scale-[0.98] transition-all"
                      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: '#9898c0', letterSpacing: '0.06em' }}
                    >
                      KEEP GOING
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {!previewMode && (
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
      )}

      {!previewMode && <BottomNav unreadCoach={unreadCount} />}
    </div>
  )
}
