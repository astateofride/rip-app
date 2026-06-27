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
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#0a0a12' }}>
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="font-display text-5xl tracking-wide" style={{ color: '#e8c547', lineHeight: 0.92 }}>
            RIDE<br />INSTRUCTOR<br />PATHWAY
          </h1>
          <p className="text-xs uppercase tracking-widest mt-3" style={{ color: '#7070a0' }}>
            ASORos RIP BETA
          </p>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs uppercase tracking-widest mb-1" style={{ color: '#7070a0' }}>
              Email
            </label>
            <input
              type="email"
              className="inp"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-widest mb-1" style={{ color: '#7070a0' }}>
              Password
            </label>
            <input
              type="password"
              className="inp"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>

          {error && (
            <p className="text-sm" style={{ color: '#ff6b9d' }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="font-display text-xl tracking-widest py-4 rounded-xl transition-opacity disabled:opacity-40"
            style={{ background: '#f0f0eb', color: '#0a0a12', letterSpacing: '0.06em' }}
          >
            {loading ? 'SIGNING IN…' : 'SIGN IN'}
          </button>
        </form>

        <p className="text-center mt-6 text-sm" style={{ color: '#7070a0' }}>
          New to RIP?{' '}
          <Link href="/signup" className="font-semibold" style={{ color: '#e8c547' }}>
            Create account
          </Link>
        </p>
      </div>
    </div>
  )
}
