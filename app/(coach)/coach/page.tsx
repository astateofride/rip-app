import { createClient } from '@/lib/supabase/server'
import CoachDashboard from '@/components/coach/CoachDashboard'
import type { Profile, TaskProgress, DayData, CoachRemark, StageSignoff, Message, SessionLog } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function CoachPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: coachProfile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  // Get all students assigned to this coach
  const { data: students } = await supabase
    .from('profiles')
    .select('*')
    .eq('coach_id', user.id)
    .eq('role', 'student')

  // Get pending students not yet assigned to any coach
  const { data: pendingStudents } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'student')
    .eq('pending', true)

  const studentIds = (students ?? []).map((s: Profile) => s.id)

  if (studentIds.length === 0) {
    return (
      <CoachDashboard
        coach={coachProfile as Profile}
        students={[]}
        pendingStudents={(pendingStudents ?? []) as Profile[]}
        allTasks={[]}
        allDayData={[]}
        allRemarks={[]}
        allSignoffs={[]}
        allMessages={[]}
        lastSessions={[]}
        coachId={user.id}
      />
    )
  }

  const [
    { data: allTasks },
    { data: allDayData },
    { data: allRemarks },
    { data: allSignoffs },
    { data: allMessages },
    { data: lastSessions },
  ] = await Promise.all([
    supabase.from('task_progress').select('*').in('student_id', studentIds),
    supabase.from('day_data').select('*').in('student_id', studentIds),
    supabase.from('coach_remarks').select('*').eq('coach_id', user.id),
    supabase.from('stage_signoffs').select('*').in('student_id', studentIds),
    supabase.from('messages').select('*').in('student_id', studentIds).order('created_at'),
    supabase.from('session_logs').select('*').in('user_id', studentIds).order('started_at', { ascending: false }),
  ])

  return (
    <CoachDashboard
      coach={coachProfile as Profile}
      students={(students ?? []) as Profile[]}
      pendingStudents={(pendingStudents ?? []) as Profile[]}
      allTasks={(allTasks ?? []) as TaskProgress[]}
      allDayData={(allDayData ?? []) as DayData[]}
      allRemarks={(allRemarks ?? []) as CoachRemark[]}
      allSignoffs={(allSignoffs ?? []) as StageSignoff[]}
      allMessages={(allMessages ?? []) as Message[]}
      lastSessions={(lastSessions ?? []) as SessionLog[]}
      coachId={user.id}
    />
  )
}
