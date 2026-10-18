import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import { ensureSession } from '../lib/session'

type Message = { id: string; role: 'user' | 'assistant'; content: string }
type Conversation = { id: string; handoff_requested: boolean }

export default function SupportChat() {
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [handoffBusy, setHandoffBusy] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)

  async function loadConversation(id?: string) {
    await ensureSession()
    const query = supabase.from('clientflow_conversations').select('id, handoff_requested')
    const { data, error } = id
      ? await query.eq('id', id).single()
      : await query.order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (error) throw error
    setConversation(data)
    if (!data) { setMessages([]); return }
    const result = await supabase.from('clientflow_messages').select('id, role, content')
      .eq('conversation_id', data.id).order('created_at', { ascending: false }).limit(100)
    if (result.error) throw result.error
    setMessages(((result.data ?? []) as Message[]).reverse())
  }

  useEffect(() => {
    let active = true
    async function start() {
      try { await loadConversation() } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Could not load conversation')
      } finally { if (active) setLoading(false) }
    }
    void start()
    return () => { active = false }
  }, [])

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || busy.current) return
    busy.current = true; setSending(true); setError('')
    try {
      const session = await ensureSession()
      const { data, error: invokeError } = await supabase.functions.invoke('clientflow-chat', {
        body: { message: text, conversationId: conversation?.id, requestId: crypto.randomUUID() },
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (invokeError) {
        if (invokeError instanceof FunctionsHttpError) {
          const details = await invokeError.context.json().catch(() => null)
          if (details?.conversationId) await loadConversation(details.conversationId)
          throw new Error(details?.error ?? 'Chat request failed')
        }
        throw invokeError
      }
      if (typeof data?.reply !== 'string' || !data?.conversationId) throw new Error('The server returned an invalid reply')
      setDraft('')
      await loadConversation(data.conversationId)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not send message') }
    finally { busy.current = false; setSending(false) }
  }

  async function requestHandoff() {
    if (!conversation || handoffBusy) return
    setHandoffBusy(true); setError('')
    try {
      const { data, error } = await supabase.from('clientflow_conversations')
        .update({ handoff_requested: true }).eq('id', conversation.id)
        .select('id, handoff_requested').single()
      if (error) throw error
      setConversation(data)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save handoff request') }
    finally { setHandoffBusy(false) }
  }

  return <section className="panel chat-panel" aria-labelledby="chat-title">
    <div className="panel-heading"><span className="eyebrow">01 / SUPPORT</span><h2 id="chat-title">Ask the assistant</h2>
      <p>Answers based on the demo FAQ. English and Persian are supported.</p></div>
    {loading ? <p className="muted">Loading conversation…</p> : <>
      <div className="chat-log" role="log" aria-live="polite" aria-label="Support conversation">
        {messages.length === 0 && <div className="empty-state">No messages yet. Ask about hours, services, or booking.</div>}
        {messages.map((item) => <article key={item.id} className={`bubble ${item.role}`}>
          <strong>{item.role === 'user' ? 'You' : 'Assistant'}</strong><p dir="auto">{item.content}</p>
        </article>)}
      </div>
      <form onSubmit={sendMessage} className="chat-form"><label htmlFor="chat-message">Your question</label>
        <textarea id="chat-message" dir="auto" rows={3} maxLength={2000} value={draft}
          onChange={(event) => setDraft(event.target.value)} disabled={sending} required placeholder="How can I book an appointment?" />
        <button type="submit" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send message →'}</button>
      </form>
      <div className="handoff"><button className="secondary" type="button" onClick={requestHandoff}
        disabled={!conversation || handoffBusy || conversation.handoff_requested}>
        {handoffBusy ? 'Saving…' : 'Request human support'}</button>
        {conversation?.handoff_requested && <p role="status">Human support request saved for this conversation.</p>}
        {!conversation && <p className="muted">Send a message to start a conversation before requesting support.</p>}
      </div>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>
}
