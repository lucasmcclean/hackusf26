import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { User, Shield } from 'lucide-react'
import { checkBackendHealth } from '../services/api'

export default function RoleSelector() {
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking')

  useEffect(() => {
    let mounted = true

    checkBackendHealth().then((ok) => {
      if (!mounted) return
      setBackendStatus(ok ? 'online' : 'offline')
    })

    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="min-h-screen tiny-grid px-6 py-10 md:py-12 md:px-10">
      <div className="mx-auto max-w-6xl">
        <div className="panel-glass rounded-3xl p-6 md:p-10">
          <div className="grid gap-8 md:grid-cols-[1.05fr_1fr] md:gap-10">
            <section className="flex flex-col justify-between">
              <div>
                <div className="soft-label mb-4">Live Coordination Hub</div>
                <h1 className="hero-title font-bold">Welcome to the Community Response Center</h1>
                <p className="mt-4 max-w-xl text-[var(--text-primary)]">
                  Built for clear communication, fast decisions, and support when every minute matters.
                </p>
              </div>
              <div className="mt-8 status-pill w-fit">
                <span
                  className={`phase-dot ${backendStatus === 'online' ? 'bg-[var(--success)]' : backendStatus === 'checking' ? 'bg-[var(--warning)]' : 'bg-[var(--danger)]'}`}
                />
                <span>{backendStatus === 'checking' ? 'Preparing services' : backendStatus === 'online' ? 'Service ready' : 'Service temporarily unavailable'}</span>
              </div>
            </section>

            <section className="grid gap-5">
              <Link to="/user" className="group">
                <article className="panel-surface rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:border-[rgba(71,195,255,0.65)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="soft-label mb-1">For People Seeking Support</div>
                      <h2 className="section-title font-semibold">Survivor Portal</h2>
                    </div>
                    <div className="rounded-xl bg-[var(--brand-soft)] p-3 text-[var(--brand)] group-hover:bg-[var(--brand)] group-hover:text-[#03131f]">
                      <User size={24} />
                    </div>
                  </div>
                  <p className="mt-4 text-sm text-[var(--text-primary)]">
                    Share updates, stay informed, and connect directly with responder teams.
                  </p>
                  <ul className="mt-4 space-y-1.5 text-sm text-[var(--text-muted)]">
                    <li>- Follow support activity live</li>
                    <li>- Send quick requests and updates</li>
                    <li>- Receive clear response messages</li>
                  </ul>
                  <div className="btn-primary mt-6 inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold">Enter as Survivor</div>
                </article>
              </Link>

              <Link to="/responder" className="group">
                <article className="panel-surface rounded-2xl p-6 transition-all duration-300 hover:-translate-y-1 hover:border-[rgba(255,121,121,0.62)]">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="soft-label mb-1">For Teams Coordinating Field Support</div>
                      <h2 className="section-title font-semibold">Responder Portal</h2>
                    </div>
                    <div className="rounded-xl bg-[rgba(255,110,110,0.14)] p-3 text-[var(--danger)] group-hover:bg-[var(--danger)] group-hover:text-[#230b0b]">
                      <Shield size={24} />
                    </div>
                  </div>
                  <p className="mt-4 text-sm text-[var(--text-primary)]">
                    Coordinate teams, monitor regions, and send updates to Survivors in real time.
                  </p>
                  <ul className="mt-4 space-y-1.5 text-sm text-[var(--text-muted)]">
                    <li>- Track active locations</li>
                    <li>- Review selected region details</li>
                    <li>- Broadcast important notices</li>
                  </ul>
                  <div className="btn-muted mt-6 inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold">Enter as Responder</div>
                </article>
              </Link>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
