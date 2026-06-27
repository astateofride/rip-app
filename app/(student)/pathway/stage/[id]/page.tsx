import { createClient } from '@/lib/supabase/server'
import { STAGES } from '@/lib/stages'
import { notFound } from 'next/navigation'
import StageView from '@/components/student/StageView'
import type { TaskProgress, DayData, CoachRemark, StageSignoff, Message } from '@/lib/types'

interface Props { params: Promise<{ id: string }> }

export default async function StagePage({ params }: Props) {
  const { id } = await params
  const stageIdx = parseInt(id)
  if (isNaN(stageIdx) || stageIdx < 0 || stageIdx > 2) notFound()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [
    { data: tasks },
    { data: dayData },
    { data: remarks },
    { data: signoffs },
    { data: messages },
  ] = await Promise.all([
    supabase.from('task_progress').select('*').eq('student_id', user.id).eq('stage_idx', stageIdx),
    supabase.from('day_data').select('*').eq('student_id', user.id).eq('stage_idx', stageIdx),
    supabase.from('coach_remarks').select('*').eq('student_id', user.id).eq('stage_idx', stageIdx),
    supabase.from('stage_signoffs').select('*').eq('student_id', user.id),
    supabase.from('messages').select('count').eq('student_id', user.id).eq('from_role', 'coach').eq('read', false),
  ])

  const unreadCount = (messages as unknown as { count: number }[])?.[0]?.count ?? 0

  return (
    <StageView
      stageIdx={stageIdx}
      userId={user.id}
      tasks={(tasks ?? []) as TaskProgress[]}
      dayData={(dayData ?? []) as DayData[]}
      remarks={(remarks ?? []) as CoachRemark[]}
      signoffs={(signoffs ?? []) as StageSignoff[]}
      unreadCount={unreadCount}
    />
  )
}
