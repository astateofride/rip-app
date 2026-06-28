export type Role = 'student' | 'coach'

export interface Profile {
  id: string
  name: string
  role: Role
  email: string | null
  location: string | null
  start_date: string | null
  coach_id: string | null
  created_at: string
}

export interface TaskProgress {
  id: string
  student_id: string
  stage_idx: number
  day_idx: number
  task_idx: number
  completed: boolean
  completed_at: string | null
  answer: string | null
}

export interface DayData {
  id: string
  student_id: string
  stage_idx: number
  day_idx: number
  reflection: string | null
  video_url: string | null
  opened_at: string | null
  manual_read_at: string | null
}

export interface CoachRemark {
  id: string
  student_id: string
  coach_id: string
  stage_idx: number
  day_idx: number
  remark: string
  updated_at: string
}

export interface StageSignoff {
  id: string
  student_id: string
  coach_id: string
  stage_idx: number
  note: string | null
  signed_at: string
}

export interface Message {
  id: string
  student_id: string
  sender_id: string
  from_role: 'student' | 'coach'
  text: string
  stage_ref: number | null
  day_ref: number | null
  read: boolean
  created_at: string
}

export interface SessionLog {
  id: string
  user_id: string
  started_at: string
  ended_at: string | null
  duration_mins: number | null
}

export interface StageDay {
  title: string
  focus: string
  manualNote: string
  tasks: { text: string; ref: string }[]
}

export interface Stage {
  id: string
  num: number
  name: string
  eyebrow: string
  colour: string
  cardClass: string
  tagline: string
  desc: string
  ref: string
  days: StageDay[]
}
