'use client'

import { useEffect, useState } from 'react'
import StudentHome from '@/components/student/StudentHome'
import StageView from '@/components/student/StageView'
import type { Profile } from '@/lib/types'
import { createClient } from '@/lib/supabase/client'

export default function CoachPreviewPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [activeStage, setActiveStage] = useState<number | null>(null)
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase.from('profiles').select('*').eq('id', user.id).single().then(({ data }) => {
        if (data) setProfile({ ...data as Profile, role: 'student' })
      })
    })
  }, [])

  if (!profile) {
    return (
      <div style={{ background: '#080810', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#9898c0', fontSize: 14 }}>Loading preview…</div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* Preview banner */}
      <div className="fixed top-0 left-0 right-0 z-[999] flex items-center justify-between px-4 py-2"
        style={{ background: '#e8c547', color: '#080810' }}>
        <div className="font-display text-sm tracking-widest" style={{ letterSpacing: '0.1em' }}>
          👁 PREVIEW — STUDENT VIEW
        </div>
        <div className="flex items-center gap-2">
          {activeStage !== null && (
            <button onClick={() => setActiveStage(null)}
              className="text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg"
              style={{ background: 'rgba(0,0,0,0.12)', color: '#080810' }}>
              ← Home
            </button>
          )}
          <a href="/coach"
            className="text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(0,0,0,0.15)', color: '#080810' }}>
            Exit
          </a>
        </div>
      </div>

      <div style={{ paddingTop: 36 }}>
        {activeStage !== null ? (
          <StageView
            stageIdx={activeStage}
            userId={profile.id}
            tasks={[]}
            dayData={[]}
            remarks={[]}
            signoffs={[]}
            unreadCount={0}
            previewMode
            onBack={() => setActiveStage(null)}
          />
        ) : (
          <StudentHome
            profile={profile}
            tasks={[]}
            signoffs={[]}
            messages={[]}
            lastSession={null}
            userId={profile.id}
            onNavigateToStage={setActiveStage}
          />
        )}
      </div>
    </div>
  )
}
