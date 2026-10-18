import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import SupportChat from './components/SupportChat'
import Booking from './components/Booking'
import './App.css'

type Faq = { id: string; question: string; answer: string }

export default function App() {
  const [faqs, setFaqs] = useState<Faq[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => { let active = true; void supabase.from('clientflow_faq')
    .select('id, question, answer').order('question').then(({ data, error }) => {
      if (!active) return
      if (error) setError(error.message)
      else setFaqs(data ?? [])
      setLoading(false)
    }); return () => { active = false } }, [])

  return <main className="page">
    <header className="topbar"><div className="brand"><span className="brand-mark">◈</span> SupabaseClientFlow</div><span className="demo-pill">PUBLIC DEMO</span></header>
    <section className="intro"><span className="eyebrow">SUPPORT, SIMPLIFIED</span><h1>Helpful answers.<br /><em>Easy appointments.</em></h1>
      <p>A small portfolio demo showing AI FAQ support, human handoff requests, and fixed-slot booking with Supabase.</p></section>
    <div className="workspace"><SupportChat /><Booking /></div>
    <section className="faq-section"><div><span className="eyebrow">REFERENCE</span><h2>Demo FAQ</h2></div>
      {loading ? <p>Loading business information…</p> : error ? <p className="error" role="alert">Could not load FAQ: {error}</p> :
        faqs.length === 0 ? <p>No FAQ entries are configured.</p> : <div className="faq-grid">{faqs.map((faq) =>
          <article key={faq.id}><h3 dir="auto">{faq.question}</h3><p dir="auto">{faq.answer}</p></article>)}</div>}
    </section>
    <footer>Demo only · No live support notification, calendar, or payment integration.</footer>
  </main>
}
