import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function POST(req: NextRequest) {
  try {
    const { userId, mins } = await req.json()
    if (!userId || typeof mins !== 'number') {
      return NextResponse.json({ error: 'invalid' }, { status: 400 })
    }

    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: () => {},
        },
      }
    )

    // Find the most recent open session for this user
    const { data: session } = await supabase
      .from('session_logs')
      .select('id')
      .eq('user_id', userId)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .single()

    if (session) {
      await supabase.from('session_logs').update({
        ended_at: new Date().toISOString(),
        duration_mins: mins,
      }).eq('id', session.id)
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'server error' }, { status: 500 })
  }
}
