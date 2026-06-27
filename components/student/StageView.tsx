'use client'

import { useState, useOptimistic, useTransition } from 'react'
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

export default function StageView({ stageIdx, userId, tasks, dayData, remarks, signoffs, unreadCount }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const stage = STAGES[stageIdx]
  const [expandedDays, setExpandedDays] = useState<Set<number>>(new Set())
  const [localTasks, setLocalTasks] = useState<TaskProgress[]>(tasks)
  const [localDayData, setLocalDayData] = useState<DayData[]>(dayData)
  const [saving, setSaving] = useState<string | null>(null)
  const [, startTransition] = useTransition()

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

  async function toggleTask(di: number, ti: number) {
    const existing = getTask(di, ti)
    const newCompleted = !existing?.completed

    // Optimistic update
    setLocalTasks(prev => {
      const idx = prev.findIndex(t => t.stage_idx === stageIdx && t.day_idx === di && t.task_idx === ti)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], completed: newCompleted }
        return next
      }
      return [...prev, { id: `temp-${di}-${ti}`, student_id: userId, stage_idx: stageIdx, day_idx: di, task_idx: ti, completed: true, completed_at: null }]
    })

    await supabase.from('task_progress').upsert({
      student_id: userId,
      stage_idx: stageIdx,
      day_idx: di,
      task_idx: ti,
      completed: newCompleted,
      completed_at: newCompleted ? new Date().toISOString() : null,
    }, { onConflict: 'student_id,stage_idx,day_idx,task_idx' })
  }

  async function toggleDay(di: number) {
    const isOpen = expandedDays.has(di)
    setExpandedDays(prev => {
      const next = new Set(prev)
      if (isOpen) next.delete(di)
      else next.add(di)
      return next
    })

    if (!isOpen && !getDayData(di)?.opened_at) {
      const now = new Date().toISOString()
      setLocalDayData(prev => {
        const idx = prev.findIndex(d => d.stage_idx === stageIdx && d.day_idx === di)
        if (idx >= 0) {
          const next = [...prev]; next[idx] = { ...next[idx], opened_at: now }; return next
        }
        return [...prev, { id: `temp-${di}`, student_id: userId, stage_idx: stageIdx, day_idx: di, reflection: null, video_url: null, opened_at: now }]
      })
      await supabase.from('day_data').upsert({ student_id: userId, stage_idx: stageIdx, day_idx: di, opened_at: now }, { onConflict: 'student_id,stage_idx,day_idx' })
    }
  }

  async function saveField(di: number, field: 'reflection' | 'video_url', value: string) {
    const key = `${di}-${field}`
    setSaving(key)
    await supabase.from('day_data').upsert(
      { student_id: userId, stage_idx: stageIdx, day_idx: di, [field]: value },
      { onConflict: 'student_id,stage_idx,day_idx' }
    )
    setSaving(null)
  }

  const colours = ['#e8c547', '#4ecdc4', '#ff6b9d']

  return (
    <div style={{ background: '#0a0a12', minHeight: '100vh', paddingBottom: 80 }}>
      <Topbar progress={overallPct()} mode="student" />

      {/* Back bar */}
      <button
        onClick={() => router.push('/pathway')}
        className="flex items-center gap-2 px-4 py-3 text-xs font-medium w-full"
        style={{ color: '#7070a0', borderBottom: '1px solid #2a2a45' }}
      >
        <span className="text-lg" style={{ color: '#f0f0eb' }}>←</span> All Stages
      </button>

      {/* Stage hero */}
      <div className="px-4 py-5" style={{ borderBottom: '1px solid #2a2a45' }}>
        <div className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: '#7070a0' }}>{stage.eyebrow}</div>
        <div className="font-display whitespace-pre-line leading-[0.92]" style={{ fontSize: 52, color: colour, letterSpacing: '0.02em' }}>{stage.name}</div>
        <p className="text-sm mt-2 leading-relaxed" style={{ color: '#7070a0' }}>{stage.desc}</p>
        <span className="inline-block mt-2 text-[10px] font-bold px-3 py-1 rounded" style={{ background: 'rgba(232,197,71,0.08)', color: '#e8c547', border: '1px solid rgba(232,197,71,0.2)' }}>
          {stage.ref}
        </span>
      </div>

      {/* Competency gate */}
      {stageIdx > 0 && (
        <div
          className="mx-4 mt-3 px-3 py-3 rounded-lg text-xs font-medium"
          style={{
            border: signoffs.some(s => s.stage_idx === stageIdx - 1)
              ? '1px solid rgba(46,204,113,0.3)' : '1px solid rgba(255,255,255,0.08)',
            background: signoffs.some(s => s.stage_idx === stageIdx - 1)
              ? 'rgba(46,204,113,0.07)' : '#1a1a2e',
            color: signoffs.some(s => s.stage_idx === stageIdx - 1) ? '#2ecc71' : '#7070a0',
          }}
        >
          {signoffs.some(s => s.stage_idx === stageIdx - 1)
            ? `✓ Stage ${stageIdx} complete — unlocked`
            : `Stage ${stageIdx} in progress — complete 75% of tasks + coach sign-off to unlock`}
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
            <div key={di} className="rounded-xl overflow-hidden" style={{ background: '#1a1a2e', border: '1px solid #2a2a45' }}>
              {/* Day header */}
              <button
                onClick={() => toggleDay(di)}
                className="flex items-center gap-3 w-full px-3.5 py-3 text-left"
                style={{ minHeight: 44 }}
              >
                <div className="font-display text-2xl leading-none flex-shrink-0 w-9 text-center" style={{ color: colour }}>
                  {String(stageIdx * 10 + di + 1).padStart(2, '0')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{day.title}</div>
                  <div className="text-[9px] uppercase tracking-widest mt-0.5" style={{ color: '#7070a0' }}>
                    {day.focus} · {taskCount}/{day.tasks.length} tasks
                  </div>
                </div>
                <div
                  className="w-6 h-6 rounded-full border flex items-center justify-center text-[11px] flex-shrink-0 transition-all"
                  style={allDone ? { background: '#2ecc71', borderColor: '#2ecc71', color: '#0a0a12' } : { borderColor: '#2a2a45' }}
                >
                  {allDone ? '✓' : ''}
                </div>
                <span style={{ color: '#7070a0', fontSize: 14, transform: isOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }}>▾</span>
              </button>

              {/* Day body */}
              {isOpen && (
                <div style={{ borderTop: '1px solid #2a2a45' }}>
                  {/* Tasks */}
                  <div className="px-3.5 pt-3.5">
                    <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: '#7070a0' }}>Tasks</div>
                    {day.tasks.map((task, ti) => {
                      const done = getTask(di, ti)?.completed ?? false
                      return (
                        <div
                          key={ti}
                          onClick={() => toggleTask(di, ti)}
                          className="flex items-start gap-2.5 py-2 cursor-pointer"
                          style={{ borderBottom: ti < day.tasks.length - 1 ? '1px solid rgba(255,255,255,0.04)' : undefined, minHeight: 44 }}
                        >
                          <div
                            className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 text-[10px] mt-0.5 transition-all"
                            style={done ? { background: '#2ecc71', borderColor: '#2ecc71', color: '#0a0a12' } : { background: '#0d0d1a', border: '1.5px solid #2a2a45' }}
                          >
                            {done ? '✓' : ''}
                          </div>
                          <div className="flex-1">
                            <div className="text-sm leading-snug" style={{ color: done ? '#7070a0' : '#f0f0eb', textDecoration: done ? 'line-through' : undefined }}>{task.text}</div>
                            <div className="text-[9px] mt-0.5 font-medium" style={{ color: '#7070a0' }}>{task.ref}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Manual note */}
                  <div className="mx-3.5 my-3 px-3 py-2.5 rounded-lg" style={{ background: '#0d0d1a', borderLeft: '2px solid #e8c547' }}>
                    <div className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: '#e8c547' }}>Manual Reference</div>
                    <div className="text-xs leading-relaxed" style={{ color: '#7070a0' }}>{day.manualNote}</div>
                  </div>

                  {/* Coach remark (read-only) */}
                  {remark && (
                    <div className="mx-3.5 mb-3 px-3 py-2.5 rounded-lg" style={{ background: 'rgba(232,197,71,0.06)', border: '1px solid rgba(232,197,71,0.2)' }}>
                      <div className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: '#e8c547' }}>Coach Note</div>
                      <div className="text-xs leading-relaxed" style={{ color: '#f0f0eb' }}>{remark.remark}</div>
                    </div>
                  )}

                  {/* Inputs */}
                  <div className="px-3.5 pb-3.5">
                    <div className="text-[9px] font-bold uppercase tracking-widest mb-1" style={{ color: '#7070a0' }}>Video Link</div>
                    <input
                      type="url"
                      className="inp"
                      placeholder="https://youtube.com/..."
                      defaultValue={dd?.video_url ?? ''}
                      onBlur={e => saveField(di, 'video_url', e.target.value)}
                    />
                    <div className="text-[9px] font-bold uppercase tracking-widest mb-1 mt-3" style={{ color: '#7070a0' }}>Reflection — What did you notice?</div>
                    <textarea
                      className="inp"
                      placeholder="Write your reflection here..."
                      defaultValue={dd?.reflection ?? ''}
                      onBlur={e => saveField(di, 'reflection', e.target.value)}
                    />

                    {/* Ask Coach */}
                    <button
                      onClick={() => router.push(`/pathway/chat?stage=${stageIdx}&day=${di}`)}
                      className="flex items-center gap-2 w-full mt-3 px-3.5 py-3 rounded-lg transition-all"
                      style={{ background: 'rgba(232,197,71,0.06)', border: '1px solid rgba(232,197,71,0.2)', minHeight: 44 }}
                    >
                      <span style={{ color: '#e8c547' }}>💬</span>
                      <span className="text-xs font-bold tracking-wide" style={{ color: '#e8c547' }}>Ask Coach</span>
                    </button>

                    {/* Sign-off display (last day only, read-only) */}
                    {isLastDay && (
                      <div
                        className="mt-3 px-3.5 py-3 rounded-lg text-xs font-medium"
                        style={coachSigned
                          ? { border: '1px solid rgba(46,204,113,0.3)', background: 'rgba(46,204,113,0.07)', color: '#2ecc71' }
                          : { border: '1px solid #2a2a45', background: '#0d0d1a', color: '#7070a0' }
                        }
                      >
                        {coachSigned ? `✓ Stage ${stageIdx + 1} signed off by coach` : 'Awaiting coach sign-off'}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Floating chat bubble */}
      <button
        onClick={() => router.push('/pathway/chat')}
        className="fixed bottom-20 right-4 w-12 h-12 rounded-full flex items-center justify-center"
        style={{ background: '#e8c547', boxShadow: '0 4px 16px rgba(232,197,71,0.3)', zIndex: 200 }}
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#0a0a12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold" style={{ background: '#ff6b9d', color: '#f0f0eb' }}>
            {unreadCount}
          </span>
        )}
      </button>

      <BottomNav unreadCoach={unreadCount} />
    </div>
  )
}
