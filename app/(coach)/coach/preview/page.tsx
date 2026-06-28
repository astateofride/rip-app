import { createClient } from '@/lib/supabase/server'
import StudentHome from '@/components/student/StudentHome'
import type { Profile } from '@/lib/types'

export default async function CoachPreviewPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  if (!profile) return null

  // Render student pathway with empty data so coach sees the full UX
  const previewProfile: Profile = { ...profile as Profile, role: 'student' }

  return (
    <div style={{ position: 'relative' }}>
      {/* Preview banner */}
      <div className="fixed top-0 left-0 right-0 z-[999] flex items-center justify-between px-4 py-2"
        style={{ background: '#e8c547', color: '#080810' }}>
        <div className="font-display text-sm tracking-widest" style={{ letterSpacing: '0.1em' }}>
          👁 PREVIEW — STUDENT VIEW
        </div>
        <a href="/coach"
          className="text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg"
          style={{ background: 'rgba(0,0,0,0.15)', color: '#080810' }}>
          ← EXIT
        </a>
      </div>
      {/* Push content below banner */}
      <div style={{ paddingTop: 36 }}>
        <StudentHome
          profile={previewProfile}
          tasks={[]}
          signoffs={[]}
          messages={[]}
          lastSession={null}
          userId={user.id}
        />
      </div>
    </div>
  )
}
