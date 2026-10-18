import { supabase } from './supabaseClient'

export async function ensureSession() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (data.session) return data.session
  const signed = await supabase.auth.signInAnonymously()
  if (signed.error || !signed.data.session) throw signed.error ?? new Error('Could not start guest session')
  return signed.data.session
}
