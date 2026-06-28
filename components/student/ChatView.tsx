'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { STAGES } from '@/lib/stages'
import type { Message, Profile } from '@/lib/types'

interface Props {
  profile: Profile
  messages: Message[]
  userId: string
  ctxStage: number | null
  ctxDay: number | null
  coachEmail?: string | null
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function ChatView({ profile, messages: initialMessages, userId, ctxStage, ctxDay, coachEmail }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const ctxLabel = ctxStage !== null && ctxDay !== null
    ? `Stage ${ctxStage + 1} · Day ${ctxStage * 10 + ctxDay + 1}`
    : null

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('messages')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `student_id=eq.${userId}`,
      }, payload => {
        setMessages(prev => prev.some(m => m.id === (payload.new as Message).id) ? prev : [...prev, payload.new as Message])
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages])

  async function send() {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    setText('')

    const { data } = await supabase.from('messages').insert({
      student_id: userId,
      sender_id: userId,
      from_role: 'student',
      text: trimmed,
      stage_ref: ctxStage,
      day_ref: ctxDay,
    }).select().single()

    if (data) setMessages(prev => [...prev, data as Message])

    setSending(false)
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <div className="flex flex-col" style={{ background: '#0a0a12', height: '100dvh' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4" style={{ background: '#1a1a2e', borderBottom: '1px solid #2a2a45', minHeight: 52, flexShrink: 0 }}>
        <button onClick={() => router.back()} className="text-xl" style={{ color: '#9898c0', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer' }}>←</button>
        <div>
          <div className="font-display text-xl tracking-wide" style={{ color: '#f0f0eb' }}>MESSAGES</div>
          <div className="text-[10px] uppercase tracking-widest" style={{ color: '#9898c0' }}>Your coach</div>
        </div>
      </div>

      {/* Context tag */}
      {ctxLabel && (
        <div className="px-4 py-2" style={{ background: 'rgba(232,197,71,0.06)', borderBottom: '1px solid rgba(232,197,71,0.15)' }}>
          <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded" style={{ background: 'rgba(232,197,71,0.12)', color: '#e8c547' }}>
            Replying about: {ctxLabel}
          </span>
        </div>
      )}

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3" style={{ paddingBottom: 8 }}>
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
            <div className="text-2xl mb-3">💬</div>
            <p className="text-sm" style={{ color: '#9898c0' }}>No messages yet.<br />Send your first message to your coach.</p>
          </div>
        ) : messages.map(m => {
          const fromMe = m.from_role === 'student'
          const stageName = m.stage_ref !== null && m.day_ref !== null
            ? `Stage ${m.stage_ref + 1} · Day ${m.stage_ref * 10 + m.day_ref + 1}`
            : null
          return (
            <div key={m.id} className={`flex flex-col ${fromMe ? 'items-end' : 'items-start'}`}>
              {stageName && (
                <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded mb-1" style={{ background: 'rgba(255,255,255,0.06)', color: '#9898c0' }}>
                  {stageName}
                </span>
              )}
              <div
                className="max-w-[80%] px-3.5 py-2.5 rounded-xl text-sm leading-snug"
                style={fromMe
                  ? { background: 'rgba(232,197,71,0.12)', border: '1px solid rgba(232,197,71,0.3)', color: '#f0f0eb', borderBottomRightRadius: 4 }
                  : { background: '#202035', border: '1px solid #2a2a45', color: '#f0f0eb', borderBottomLeftRadius: 4 }
                }
              >
                {m.text}
              </div>
              <div className="text-[9px] mt-1" style={{ color: '#9898c0' }}>{timeAgo(m.created_at)}</div>
            </div>
          )
        })}
      </div>

      {/* Input */}
      <div className="flex gap-2 px-4 py-3 items-end" style={{ background: '#0a0a12', borderTop: '1px solid #2a2a45', flexShrink: 0 }}>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a message…"
          rows={1}
          className="inp flex-1"
          style={{ minHeight: 42, maxHeight: 100, resize: 'none' }}
        />
        <button
          onClick={send}
          disabled={!text.trim() || sending}
          className="font-display text-base px-4 rounded-lg disabled:opacity-40 transition-opacity"
          style={{ background: '#e8c547', color: '#0a0a12', minHeight: 42, letterSpacing: '0.04em' }}
        >
          SEND
        </button>
      </div>
    </div>
  )
}
