import { createClient } from '@/lib/supabase/server'
import CoachDashboard from '@/components/coach/CoachDashboard'
import type { Profile, TaskProgress, DayData, CoachRemark, StageSignoff, Message, SessionLog, CoachNote } from '@/lib/types'

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

  // Get all coaches (for flagging notes)
  const { data: allCoaches } = await supabase
    .from('profiles')
    .select('id, name, email')
    .eq('role', 'coach')

  const studentIds = (students ?? []).map((s: Profile) => s.id)

  const [
    { data: allTasks },
    { data: allDayData },
    { data: allRemarks },
    { data: allSignoffs },
    { data: allMessages },
    { data: lastSessions },
    { data: coachNotes },
  ] = await Promise.all([
    studentIds.length > 0 ? supabase.from('task_progress').select('*').in('student_id', studentIds) : Promise.resolve({ data: [] }),
    studentIds.length > 0 ? supabase.from('day_data').select('*').in('student_id', studentIds) : Promise.resolve({ data: [] }),
    supabase.from('coach_remarks').select('*').eq('coach_id', user.id),
    studentIds.length > 0 ? supabase.from('stage_signoffs').select('*').in('student_id', studentIds) : Promise.resolve({ data: [] }),
    studentIds.length > 0 ? supabase.from('messages').select('*').in('student_id', studentIds).order('created_at') : Promise.resolve({ data: [] }),
    studentIds.length > 0 ? supabase.from('session_logs').select('*').in('user_id', studentIds).order('started_at', { ascending: false }) : Promise.resolve({ data: [] }),
    supabase.from('coach_notes').select('*').eq('coach_id', user.id).order('created_at', { ascending: false }),
  ])

  return (
    <CoachDashboard
      coach={coachProfile as Profile}
      students={(students ?? []) as Profile[]}
      pendingStudents={(pendingStudents ?? []) as Profile[]}
      allCoaches={(allCoaches ?? []) as Profile[]}
      allTasks={(allTasks ?? []) as TaskProgress[]}
      allDayData={(allDayData ?? []) as DayData[]}
      allRemarks={(allRemarks ?? []) as CoachRemark[]}
      allSignoffs={(allSignoffs ?? []) as StageSignoff[]}
      allMessages={(allMessages ?? []) as Message[]}
      lastSessions={(lastSessions ?? []) as SessionLog[]}
      coachNotes={(coachNotes ?? []) as CoachNote[]}
      coachId={user.id}
    />
  )
}
