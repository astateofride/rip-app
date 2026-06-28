import { createClient } from '@/lib/supabase/server'
import { STAGES, STAGE_LINES } from '@/lib/stages'
import StudentHome from '@/components/student/StudentHome'
import type { TaskProgress, StageSignoff, Message, Profile, SessionLog } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function PathwayPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Small delay to allow trigger to create profile on first login
  await new Promise(r => setTimeout(r, 500))

  console.log('User ID on server:', user.id)

  const [
    { data: profile },
    { data: tasks },
    { data: signoffs },
    { data: messages },
    { data: sessions },
  ] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('task_progress').select('*').eq('student_id', user.id),
    supabase.from('stage_signoffs').select('*').eq('student_id', user.id),
    supabase.from('messages').select('*').eq('student_id', user.id).order('created_at'),
    supabase.from('session_logs').select('*').eq('user_id', user.id).order('started_at', { ascending: false }).limit(1),
  ])

  if (!profile) {
    return (
      <div style={{ background: '#0a0a12', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9898c0', fontSize: 14 }}>
        Setting up your profile…
      </div>
    )
  }

  return (
    <StudentHome
      profile={profile as Profile}
      tasks={(tasks ?? []) as TaskProgress[]}
      signoffs={(signoffs ?? []) as StageSignoff[]}
      messages={(messages ?? []) as Message[]}
      lastSession={(sessions?.[0] ?? null) as SessionLog | null}
      userId={user.id}
    />
  )
}
