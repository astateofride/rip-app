'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function SignupPage() {
  const router = useRouter()
  const supabase = createClient()
  const [form, setForm] = useState({
    name: '', email: '', password: '', confirmPassword: '',
    role: 'student' as 'student' | 'coach',
    location: '', coachEmail: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function update(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)

    console.log('Attempting signup with:', form.email, form.role)
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: { name: form.name, role: form.role },
      },
    })

    console.log('authData:', JSON.stringify(authData))
    console.log('authError:', JSON.stringify(authError))

    if (authError) {
      setError(authError.message || authError.code || JSON.stringify(authError))
      setLoading(false)
      return
    }

    if (!authData.user) {
      setError('Signup failed — please try again')
      setLoading(false)
      return
    }

    // If email confirmation is required, user.identities will be empty
    if (authData.user.identities?.length === 0) {
      setError('An account with this email already exists')
      setLoading(false)
      return
    }

    // Update profile with location
    if (form.location) {
      await supabase.from('profiles').update({ location: form.location }).eq('id', authData.user.id)
    }

    // Look up coach by email if student provided one
    if (form.role === 'student' && form.coachEmail) {
      const { data: coachProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', form.coachEmail)
        .eq('role', 'coach')
        .single()
      if (coachProfile) {
        await supabase.from('profiles').update({ coach_id: coachProfile.id }).eq('id', authData.user.id)
      }
    }

    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12" style={{ background: '#080810' }}>
      <div className="w-full flex flex-col gap-6" style={{ maxWidth: 420 }}>

        {/* Brand — matches login */}
        <div style={{ paddingTop: 8, paddingBottom: 4 }}>
          <div className="font-display leading-none mb-3" style={{ letterSpacing: '0.03em' }}>
            <div style={{ fontSize: 72, color: '#f0f0eb', lineHeight: 0.88 }}>RIDE</div>
            <div style={{ fontSize: 72, color: '#e8c547', lineHeight: 0.88 }}>INSTRUCTOR</div>
            <div style={{ fontSize: 72, color: '#f0f0eb', lineHeight: 0.88 }}>PATHWAY</div>
          </div>
          <div style={{ width: 48, height: 3, background: '#e8c547', borderRadius: 2, marginBottom: 16 }} />
          <p className="text-sm leading-relaxed" style={{ color: '#4a4a70' }}>
            Create your account to begin the RIDE certification pathway.
          </p>
        </div>

        <div>
          {/* Instruction set */}
          <div className="rounded-2xl p-4 flex flex-col gap-3 mb-6" style={{ background: '#111120', border: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="text-xs font-bold uppercase tracking-widest" style={{ color: '#e8c547' }}>Before you start</div>

            <div className="flex gap-3">
              <span className="font-display text-xl flex-shrink-0 mt-0.5" style={{ color: '#e8c547' }}>01</span>
              <p className="text-sm leading-relaxed" style={{ color: '#f0f0eb' }}>
                Create your account below. Your coach will be linked automatically when you enter their email.
              </p>
            </div>

            <div className="flex gap-3">
              <span className="font-display text-xl flex-shrink-0 mt-0.5" style={{ color: '#e8c547' }}>02</span>
              <p className="text-sm leading-relaxed" style={{ color: '#f0f0eb' }}>
                Work through each stage in order. Read the manual reference, complete the tasks, submit your written answers.
              </p>
            </div>

            <div className="flex gap-3">
              <span className="font-display text-xl flex-shrink-0 mt-0.5" style={{ color: '#e8c547' }}>03</span>
              <div>
                <p className="text-sm leading-relaxed" style={{ color: '#f0f0eb' }}>
                  Some tasks require you to record yourself on the bike. Submit video one of two ways:
                </p>
                <div className="mt-2 flex flex-col gap-2">
                  <div className="flex items-start gap-2 px-3 py-2 rounded-xl" style={{ background: 'rgba(78,205,196,0.08)', border: '1px solid rgba(78,205,196,0.2)' }}>
                    <span className="text-base flex-shrink-0">📁</span>
                    <div>
                      <div className="text-xs font-bold" style={{ color: '#4ecdc4' }}>Google Drive</div>
                      <div className="text-xs leading-relaxed mt-0.5" style={{ color: '#7070a0' }}>Record → upload to Drive → right-click → Share → "Anyone with the link" → paste the link in your task</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 px-3 py-2 rounded-xl" style={{ background: 'rgba(255,107,157,0.08)', border: '1px solid rgba(255,107,157,0.2)' }}>
                    <span className="text-base flex-shrink-0">▶</span>
                    <div>
                      <div className="text-xs font-bold" style={{ color: '#ff6b9d' }}>YouTube</div>
                      <div className="text-xs leading-relaxed mt-0.5" style={{ color: '#7070a0' }}>Upload → set visibility to <strong style={{ color: '#f0f0eb' }}>"Unlisted"</strong> (not Private) → paste the link in your task</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <span className="font-display text-xl flex-shrink-0 mt-0.5" style={{ color: '#e8c547' }}>04</span>
              <p className="text-sm leading-relaxed" style={{ color: '#f0f0eb' }}>
                Your coach reviews your progress, leaves notes, and signs off each stage before you can advance.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSignup} className="flex flex-col gap-4 rounded-3xl p-5"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>

          <div className="flex gap-2">
            {(['student', 'coach'] as const).map(r => (
              <button
                key={r}
                type="button"
                onClick={() => update('role', r)}
                className="flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all"
                style={{
                  background: form.role === r ? '#e8c547' : 'rgba(255,255,255,0.04)',
                  color: form.role === r ? '#080810' : '#7070a0',
                  border: form.role === r ? '1px solid #e8c547' : '1px solid rgba(255,255,255,0.07)',
                }}
              >
                {r === 'student' ? '🎓 Student' : '🏆 Coach'}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#4a4a70' }}>Full name</label>
            <input className="inp" value={form.name} onChange={e => update('name', e.target.value)} placeholder="Your name" required style={{ fontSize: 16 }} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#4a4a70' }}>Email</label>
            <input type="email" className="inp" value={form.email} onChange={e => update('email', e.target.value)} placeholder="you@example.com" required style={{ fontSize: 16 }} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#4a4a70' }}>Location / Club</label>
            <input className="inp" value={form.location} onChange={e => update('location', e.target.value)} placeholder="Your studio or club" style={{ fontSize: 16 }} />
          </div>

          {form.role === 'student' && (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#4a4a70' }}>
                Coach email <span style={{ color: '#3a3a5c', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
              </label>
              <input type="email" className="inp" value={form.coachEmail} onChange={e => update('coachEmail', e.target.value)} placeholder="coach@astateofride.com" style={{ fontSize: 16 }} />
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#4a4a70' }}>Password</label>
            <input type="password" className="inp" value={form.password} onChange={e => update('password', e.target.value)} placeholder="Min 8 characters" required minLength={8} style={{ fontSize: 16 }} />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#4a4a70' }}>Confirm password</label>
            <input type="password" className="inp" value={form.confirmPassword} onChange={e => update('confirmPassword', e.target.value)} placeholder="Repeat password" required style={{ fontSize: 16 }} />
          </div>

          {error && (
            <div className="px-4 py-3 rounded-xl text-sm font-semibold" style={{ background: 'rgba(255,107,157,0.08)', border: '1px solid rgba(255,107,157,0.25)', color: '#ff6b9d' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="font-display tracking-widest py-4 rounded-2xl transition-all disabled:opacity-30 active:scale-[0.98]"
            style={{ fontSize: 24, background: '#e8c547', color: '#080810', letterSpacing: '0.06em' }}
          >
            {loading ? 'CREATING…' : 'CREATE ACCOUNT →'}
          </button>
        </form>

        <p className="text-center text-sm" style={{ color: '#7070a0' }}>
          Already have an account?{' '}
          <Link href="/login" className="font-semibold" style={{ color: '#e8c547' }}>Sign in →</Link>
        </p>

        <p className="text-center text-[10px] uppercase tracking-widest" style={{ color: '#2a2a3c' }}>BETA · VER 1.0</p>
      </div>
    </div>
  )
}
