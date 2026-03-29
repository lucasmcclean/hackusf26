import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { Shield, Search, MessageSquare } from 'lucide-react'
import { ChatPanel, type ChatMessage } from './ChatPanel'
import { MapCanvas } from './MapCanvas'
import {
  connectRealtimeSession,
  queryMessages,
  sendMessage,
  type LocationTuple,
  type RegionPolygon,
  type SessionController,
} from '../services/api'

function getCurrentLocation(): Promise<LocationTuple | null> {
  if (!navigator.geolocation) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve([position.coords.latitude, position.coords.longitude])
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    )
  })
}

function getLocationErrorMessage(error: GeolocationPositionError): string {
  if (error.code === 1) return 'Location permission is off'
  if (error.code === 2) return 'Location is temporarily unavailable'
  if (error.code === 3) return 'Location request timed out'
  return 'Location not available'
}

export default function ResponderView() {
  const [clientId, setClientId] = useState('connecting...')
  const [connectionState, setConnectionState] = useState('Connecting')
  const [connectionPhase, setConnectionPhase] = useState('Preparing your secure session')
  const [locationState, setLocationState] = useState('Finding your location')
  const [locationRetryKey, setLocationRetryKey] = useState(0)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [queryText, setQueryText] = useState('')
  const [queryResult, setQueryResult] = useState('')
  const [isQuerying, setIsQuerying] = useState(false)
  const [locations, setLocations] = useState<LocationTuple[]>([])
  const [regions, setRegions] = useState<RegionPolygon[]>([])
  const [sessionController, setSessionController] = useState<SessionController | null>(null)

  useEffect(() => {
    let sessionController: SessionController | null = null
    let mounted = true

    async function startSession() {
      const location = await getCurrentLocation()
      if (location) {
        setLocationState('Location ready')
      }

      try {
        const controller = await connectRealtimeSession({
          role: 'responder',
          location,
          onClientId: (id) => {
            if (!mounted) return
            setClientId(id)
            setConnectionState('Connected')
          },
          onData: (data) => {
            if (!mounted) return
            setLocations(data.locations)
            setRegions(data.regions)
            if (data.regionDebug) {
              console.debug('Region debug (responder)', data.regionDebug)
            }
          },
          onDisconnect: () => {
            if (!mounted) return
            setConnectionState('Disconnected')
          },
          onError: () => {
            if (!mounted) return
            setConnectionState('Error')
          },
        })
        if (!mounted) {
          controller.close()
          return
        }
        sessionController = controller
        setSessionController(controller)
      } catch {
        if (!mounted) return
        setConnectionState('Error')
      }
    }

    startSession()

    return () => {
      mounted = false
      sessionController?.close()
    }
  }, [])

  useEffect(() => {
    if (connectionState === 'Connected') {
      setConnectionPhase('Live updates are ready')
      return
    }

    if (connectionState === 'Disconnected') {
      setConnectionPhase('Reconnecting to live updates')
      return
    }

    if (connectionState === 'Error') {
      setConnectionPhase('Unable to connect right now')
      return
    }

    const phases = [
      'Preparing your secure session',
      'Connecting to support services',
      'Syncing live updates',
    ]

    setConnectionPhase(phases[0])
    let phaseIndex = 0
    const phaseInterval = window.setInterval(() => {
      phaseIndex = Math.min(phaseIndex + 1, phases.length - 1)
      setConnectionPhase(phases[phaseIndex])
    }, 1150)

    return () => {
      window.clearInterval(phaseInterval)
    }
  }, [connectionState])

  useEffect(() => {
    if (!sessionController) return
    if (!navigator.geolocation) {
      setLocationState('Location sharing is not supported on this device')
      return
    }

    setLocationState('Finding your location')

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const nextLocation: LocationTuple = [position.coords.latitude, position.coords.longitude]
        setLocationState('Location ready')
        sessionController.sendLocation(nextLocation)
      },
      (error) => {
        setLocationState(getLocationErrorMessage(error))
      },
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 120000 },
    )

    return () => {
      navigator.geolocation.clearWatch(watchId)
    }
  }, [sessionController, locationRetryKey])

  const liveBadgeClass = useMemo(() => {
    if (connectionState === 'Connected') return 'bg-[var(--success)]'
    if (connectionState === 'Connecting') return 'bg-[var(--warning)]'
    return 'bg-[var(--danger)]'
  }, [connectionState])

  const connectionStep = useMemo(() => {
    if (connectionState === 'Connected') return 3
    if (connectionState === 'Disconnected' || connectionState === 'Error') return 1
    if (connectionPhase.includes('Connecting')) return 1
    if (connectionPhase.includes('Syncing')) return 2
    return 0
  }, [connectionPhase, connectionState])

  const handleSendMessage = async (content: string) => {
    if (!clientId || clientId === 'connecting...') return

    const outgoingMessage: ChatMessage = {
      id: `local-${Date.now()}`,
      from: clientId,
      to: 'broadcast',
      content,
      timestamp: new Date(),
      fromType: 'Responder',
    }

    setMessages((previous) => [...previous, outgoingMessage])

    try {
      await sendMessage(clientId, content, 'responder')
    } catch {
      setMessages((previous) => [...previous, {
        id: `system-${Date.now()}`,
        from: 'system',
        to: clientId,
        content: 'Broadcast was not sent. Please try again in a moment.',
        timestamp: new Date(),
        fromType: 'System',
      }])
    }
  }

  const handleQuery = async () => {
    if (!queryText.trim() || !clientId || clientId === 'connecting...') return

    setIsQuerying(true)
    try {
      const content = await queryMessages(clientId, queryText.trim())
      setQueryResult(content || 'No matching updates were found.')
    } catch {
      setQueryResult('Search is currently unavailable. Please try again shortly.')
    } finally {
      setIsQuerying(false)
    }
  }

  const handleKeyPress = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleQuery()
    }
  }

  return (
    <div className="h-screen flex flex-col bg-transparent">
      <header className="px-5 pt-5 md:px-6 md:pt-6">
        <div className="panel-glass rounded-2xl px-4 py-4 md:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-xl border border-[var(--border-soft)] bg-[rgba(255,110,110,0.14)] p-2.5 text-[var(--danger)]">
                <Shield size={22} />
              </div>
              <div>
                <h1 className="text-xl font-semibold">Responder Coordination Portal</h1>
                <p className="text-sm text-[var(--text-muted)]">
                  Session reference: {clientId === 'connecting...' ? 'Assigning...' : clientId}
                </p>
              </div>
            </div>

            <div className="min-w-[18rem]">
              <div className="status-pill w-fit">
                <div className={`w-2 h-2 rounded-full animate-pulse ${liveBadgeClass}`} />
                <span>{connectionPhase}</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-[rgba(145,170,203,0.2)]">
                <div
                  className="h-full rounded-full bg-[var(--brand)] transition-all duration-500"
                  style={{ width: `${((connectionStep + 1) / 4) * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden px-5 pb-5 pt-4 md:px-6 md:pb-6">
        <div className="h-full grid gap-4 xl:grid-cols-[20rem_1fr_22rem]">
          <aside className="min-h-0 flex flex-col gap-4">
            <div className="panel-glass rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Search className="text-[var(--danger)]" size={18} />
                <h3 className="section-title font-semibold">Message Search</h3>
              </div>
              <div className="space-y-2">
                <input
                  type="text"
                  value={queryText}
                  onChange={(event) => setQueryText(event.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder="Search incident updates..."
                  className="w-full rounded-lg border border-[var(--border-soft)] bg-[rgba(10,20,35,0.85)] px-3 py-2 text-sm text-[var(--text-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--danger)]"
                />
                <button
                  onClick={handleQuery}
                  disabled={isQuerying}
                  className="w-full rounded-lg border border-[rgba(255,130,130,0.55)] bg-[rgba(255,110,110,0.16)] px-4 py-2 text-sm font-semibold text-[#ffd9d9] transition hover:bg-[rgba(255,110,110,0.24)] disabled:opacity-60"
                >
                  {isQuerying ? 'Searching...' : 'Search'}
                </button>
              </div>

              {queryResult && (
                <div className="mt-4 border-t border-[var(--border-soft)] pt-4">
                  <span className="soft-label">Result</span>
                  <p className="mt-2 rounded-lg border border-[var(--border-soft)] bg-[rgba(8,16,29,0.72)] p-2 text-sm text-[var(--text-primary)]">{queryResult}</p>
                </div>
              )}
            </div>

          </aside>

          <section className="panel-glass rounded-2xl p-4 md:p-5 flex flex-col overflow-hidden">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="text-[var(--brand)]" size={18} />
                <h2 className="section-title font-semibold">Operational Overview</h2>
              </div>
              <button
                type="button"
                onClick={() => setLocationRetryKey((value) => value + 1)}
                className="btn-muted rounded-lg px-3 py-1.5 text-xs font-semibold"
              >
                Refresh location
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--border-soft)] bg-[rgba(8,16,29,0.75)] p-2">
              <MapCanvas locations={locations} regions={regions} />
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              <div className="panel-surface rounded-xl px-3 py-2">
                <div className="soft-label mb-1">Active points</div>
                <div className="text-sm font-semibold text-[var(--text-strong)]">{locations.length}</div>
              </div>
              <div className="panel-surface rounded-xl px-3 py-2">
                <div className="soft-label mb-1">Location status</div>
                <div className="text-sm font-semibold text-[var(--text-strong)]">{locationState}</div>
              </div>
            </div>
          </section>

          <aside className="min-h-0">
            <ChatPanel
              messages={messages}
              currentUserId={clientId}
              currentUserType="Responder"
              onSendMessage={handleSendMessage}
              showBroadcast
            />
            <div className="panel-glass mt-4 rounded-2xl p-4">
              <div className="soft-label mb-2">Team actions</div>
              <ul className="space-y-1.5 text-sm text-[var(--text-primary)]">
                <li>- Monitor incoming activity in real time</li>
                <li>- Send broad updates to all Survivors</li>
                <li>- Use search to revisit prior context</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
