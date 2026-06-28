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
    <div className="min-h-screen flex flex-col px-6 py-12" style={{ background: '#080810' }}>

      {/* Top brand mark */}
      <div className="mb-auto">
        <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: '#3a3a5c' }}>BETA · VER 1.0</div>
        <div className="flex items-center gap-2">
          <div className="w-1 h-8 rounded-full" style={{ background: '#e8c547' }} />
          <div className="font-display leading-none" style={{ fontSize: 18, color: '#4a4a70', letterSpacing: '0.1em' }}>
            RIDE <span style={{ color: '#e8c547' }}>INSTRUCTOR</span> PATHWAY
          </div>
        </div>
      </div>

      {/* Hero */}
      <div className="my-10">
        <div className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#3a3a5c' }}>Welcome back</div>
        <h1 className="font-display leading-none mb-2" style={{ fontSize: 64, color: '#f0f0eb', letterSpacing: '0.01em', lineHeight: 0.88 }}>
          SIGN<br /><span style={{ color: '#e8c547' }}>IN.</span>
        </h1>
        <p className="text-sm mt-4" style={{ color: '#4a4a70' }}>Your pathway continues where you left off.</p>
      </div>

      {/* Form */}
      <form onSubmit={handleLogin} className="flex flex-col gap-4 mb-6 rounded-3xl p-5"
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
          className="font-display tracking-widest py-5 rounded-2xl mt-2 transition-all disabled:opacity-30 active:scale-[0.98]"
          style={{ fontSize: 28, background: '#e8c547', color: '#080810', letterSpacing: '0.06em', boxShadow: '0 0 40px rgba(232,197,71,0.25)' }}
        >
          {loading ? 'SIGNING IN…' : 'SIGN IN →'}
        </button>
      </form>

      {/* Footer */}
      <div className="mt-auto text-center">
        <p className="text-sm" style={{ color: '#3a3a5c' }}>
          First time here?{' '}
          <Link href="/signup" className="font-bold" style={{ color: '#e8c547' }}>
            Create account
          </Link>
        </p>
        <p className="text-[10px] mt-4 uppercase tracking-widest" style={{ color: '#2a2a3c' }}>BETA · VER 1.0</p>
      </div>

    </div>
  )
}
