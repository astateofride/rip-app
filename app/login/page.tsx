'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12" style={{ background: '#080810' }}>
      <div className="w-full flex flex-col gap-6" style={{ maxWidth: 420 }}>

        {/* Brand */}
        <div style={{ paddingTop: 8, paddingBottom: 4 }}>
          <div className="font-display leading-none mb-3" style={{ letterSpacing: '0.03em' }}>
            <div style={{ fontSize: 72, color: '#f0f0eb', lineHeight: 0.88 }}>RIDE</div>
            <div style={{ fontSize: 72, color: '#e8c547', lineHeight: 0.88 }}>INSTRUCTOR</div>
            <div style={{ fontSize: 72, color: '#f0f0eb', lineHeight: 0.88 }}>PATHWAY</div>
          </div>
          <div style={{ width: 48, height: 3, background: '#e8c547', borderRadius: 2, marginBottom: 16 }} />
          <p className="text-sm leading-relaxed" style={{ color: '#4a4a70' }}>
            The official certification pathway for RIDE indoor cycling instructors. 3 stages · coach sign-off required.
          </p>
        </div>

        {/* New user CTA — prominent */}
        <Link href="/signup"
          className="w-full flex items-center justify-between px-5 py-4 rounded-2xl transition-all active:scale-[0.98]"
          style={{ background: 'rgba(232,197,71,0.08)', border: '2px solid rgba(232,197,71,0.4)', textDecoration: 'none' }}>
          <div>
            <div className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: '#e8c547' }}>First time here?</div>
            <div className="font-display text-2xl" style={{ color: '#f0f0eb', letterSpacing: '0.04em' }}>CREATE ACCOUNT →</div>
          </div>
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(232,197,71,0.12)', border: '1px solid rgba(232,197,71,0.3)' }}>
            <span style={{ color: '#e8c547', fontSize: 18 }}>+</span>
          </div>
        </Link>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
          <span className="text-xs font-bold uppercase tracking-widest" style={{ color: '#2a2a4a' }}>Already have an account</span>
          <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
        </div>

        {/* Sign in form */}
        <form onSubmit={handleLogin} className="flex flex-col gap-4 rounded-3xl p-5"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#4a4a70' }}>Email</label>
            <input
              type="email"
              className="inp"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              style={{ fontSize: 16 }}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#4a4a70' }}>Password</label>
            <input
              type="password"
              className="inp"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              style={{ fontSize: 16 }}
            />
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
            {loading ? 'SIGNING IN…' : 'SIGN IN →'}
          </button>
        </form>

        <p className="text-center text-[10px] uppercase tracking-widest" style={{ color: '#2a2a3c' }}>BETA · VER 1.0</p>
      </div>
    </div>
  )
}
