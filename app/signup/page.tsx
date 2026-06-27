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

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: { name: form.name, role: form.role },
      },
    })

    if (authError || !authData.user) {
      setError(authError?.message || 'Sign up failed')
      setLoading(false)
      return
    }

    // Update profile with extra fields
    const updates: Record<string, unknown> = {
      name: form.name,
      location: form.location || null,
    }

    if (form.role === 'student' && form.coachEmail) {
      // Look up coach by email
      const { data: coachProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'coach')
        .filter('id', 'in', `(
          SELECT id FROM auth.users WHERE email = '${form.coachEmail}'
        )`)
        .single()
      if (coachProfile) updates.coach_id = coachProfile.id
    }

    await supabase.from('profiles').update(updates).eq('id', authData.user.id)

    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8" style={{ background: '#0a0a12' }}>
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <h1 className="font-display text-4xl tracking-wide" style={{ color: '#e8c547', lineHeight: 0.92 }}>
            BEGIN YOUR<br />PATHWAY
          </h1>
          <p className="text-xs uppercase tracking-widest mt-3" style={{ color: '#7070a0' }}>
            Create your account
          </p>
        </div>

        <form onSubmit={handleSignup} className="flex flex-col gap-4">
          {/* Role selector */}
          <div className="flex gap-2">
            {(['student', 'coach'] as const).map(r => (
              <button
                key={r}
                type="button"
                onClick={() => update('role', r)}
                className="flex-1 py-3 rounded-lg text-xs font-bold uppercase tracking-widest transition-all"
                style={{
                  background: form.role === r ? '#e8c547' : '#1a1a2e',
                  color: form.role === r ? '#0a0a12' : '#7070a0',
                  border: form.role === r ? '1px solid #e8c547' : '1px solid #2a2a45',
                }}
              >
                {r === 'student' ? '🎓 Student' : '🏆 Coach'}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs uppercase tracking-widest mb-1" style={{ color: '#7070a0' }}>Full name</label>
            <input className="inp" value={form.name} onChange={e => update('name', e.target.value)} placeholder="Your name" required />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-widest mb-1" style={{ color: '#7070a0' }}>Email</label>
            <input type="email" className="inp" value={form.email} onChange={e => update('email', e.target.value)} placeholder="you@example.com" required />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-widest mb-1" style={{ color: '#7070a0' }}>Location / Club</label>
            <input className="inp" value={form.location} onChange={e => update('location', e.target.value)} placeholder="Your studio or club" />
          </div>

          {form.role === 'student' && (
            <div>
              <label className="block text-xs uppercase tracking-widest mb-1" style={{ color: '#7070a0' }}>Coach email <span style={{ color: '#7070a0', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
              <input type="email" className="inp" value={form.coachEmail} onChange={e => update('coachEmail', e.target.value)} placeholder="coach@astateofride.com" />
            </div>
          )}

          <div>
            <label className="block text-xs uppercase tracking-widest mb-1" style={{ color: '#7070a0' }}>Password</label>
            <input type="password" className="inp" value={form.password} onChange={e => update('password', e.target.value)} placeholder="Min 8 characters" required minLength={8} />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-widest mb-1" style={{ color: '#7070a0' }}>Confirm password</label>
            <input type="password" className="inp" value={form.confirmPassword} onChange={e => update('confirmPassword', e.target.value)} placeholder="Repeat password" required />
          </div>

          {error && <p className="text-sm" style={{ color: '#ff6b9d' }}>{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="font-display text-xl tracking-widest py-4 rounded-xl mt-2 transition-opacity disabled:opacity-40"
            style={{ background: '#f0f0eb', color: '#0a0a12', letterSpacing: '0.06em' }}
          >
            {loading ? 'CREATING…' : 'CREATE ACCOUNT'}
          </button>
        </form>

        <p className="text-center mt-6 text-sm" style={{ color: '#7070a0' }}>
          Already have an account?{' '}
          <Link href="/login" className="font-semibold" style={{ color: '#e8c547' }}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}
