import { createClient } from '@/lib/supabase/server'
import ChatView from '@/components/student/ChatView'
import type { Message, Profile } from '@/lib/types'

interface Props {
  searchParams: Promise<{ stage?: string; day?: string }>
}

export default async function ChatPage({ searchParams }: Props) {
  const { stage, day } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: profile }, { data: messages }] = await Promise.all([
    supabase.from('profiles').select('*, coach:coach_id(name, id, email)').eq('id', user.id).single(),
    supabase.from('messages').select('*').eq('student_id', user.id).order('created_at'),
  ])

  const coachEmail = (profile as unknown as { coach?: { email?: string } })?.coach?.email ?? null

  // Mark coach messages as read
  await supabase
    .from('messages')
    .update({ read: true })
    .eq('student_id', user.id)
    .eq('from_role', 'coach')
    .eq('read', false)

  return (
    <ChatView
      profile={profile as Profile}
      messages={(messages ?? []) as Message[]}
      userId={user.id}
      ctxStage={stage ? parseInt(stage) : null}
      ctxDay={day ? parseInt(day) : null}
      coachEmail={coachEmail}
    />
  )
}
