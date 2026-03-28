import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { Shield, Search, FileText, MessageSquare } from 'lucide-react'
import { ChatPanel, type ChatMessage } from './ChatPanel'
import { MapCanvas } from './MapCanvas'
import {
  connectRealtimeSession,
  queryMessages,
  sendMessage,
  type LocationTuple,
  type RegionGroup,
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
  if (error.code === 1) return 'Permission denied'
  if (error.code === 2) return 'Location unavailable'
  if (error.code === 3) return 'Location timeout'
  return 'Location error'
}

export default function ResponderView() {
  const [clientId, setClientId] = useState('connecting...')
  const [connectionState, setConnectionState] = useState('Connecting')
  const [locationState, setLocationState] = useState('Locating')
  const [locationRetryKey, setLocationRetryKey] = useState(0)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [queryText, setQueryText] = useState('')
  const [queryResult, setQueryResult] = useState('')
  const [isQuerying, setIsQuerying] = useState(false)
  const [locations, setLocations] = useState<LocationTuple[]>([])
  const [regions, setRegions] = useState<RegionGroup[]>([])
  const [selectedRegionIndex, setSelectedRegionIndex] = useState<number | null>(null)
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
    if (!sessionController) return
    if (!navigator.geolocation) {
      setLocationState('Geolocation unsupported')
      return
    }

    setLocationState('Locating')

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
    if (connectionState === 'Connected') return 'bg-green-600'
    if (connectionState === 'Connecting') return 'bg-amber-500'
    return 'bg-red-600'
  }, [connectionState])

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
        content: 'Failed to send broadcast to backend /message endpoint.',
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
      setQueryResult(content || 'No content returned from /query')
    } catch {
      setQueryResult('Query request failed against backend /query endpoint.')
    } finally {
      setIsQuerying(false)
    }
  }

  const handleKeyPress = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleQuery()
    }
  }

  const selectedRegionNodeCount = selectedRegionIndex === null
    ? 0
    : regions[selectedRegionIndex]?.length ?? 0

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      <header className="bg-white border-b border-gray-300 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="text-red-500" size={28} />
            <div>
              <h1 className="text-xl font-semibold">Emergency Response - Responder Portal</h1>
              <p className="text-sm text-gray-600">Client ID: {clientId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-gray-700">
            <div className={`w-2 h-2 rounded-full animate-pulse ${liveBadgeClass}`} />
            <span className="text-sm">{connectionState}</span>
          </div>
        </div>
      </header>

      <div className="flex-1 flex gap-4 p-6 overflow-hidden">
        <div className="w-80 flex flex-col gap-4">
          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-300">
            <div className="flex items-center gap-2 mb-3">
              <Search className="text-red-500" size={20} />
              <h3 className="font-semibold">Backend Query (`/query`)</h3>
            </div>
            <div className="space-y-2">
              <input
                type="text"
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
                onKeyDown={handleKeyPress}
                placeholder="Search distress context..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
              />
              <button
                onClick={handleQuery}
                disabled={isQuerying}
                className="w-full px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-60 flex items-center justify-center gap-2 text-sm"
              >
                <Search size={16} />
                {isQuerying ? 'Searching...' : 'Search'}
              </button>
            </div>

            {queryResult && (
              <div className="mt-4 border-t border-gray-200 pt-4">
                <span className="text-sm font-semibold">Result</span>
                <p className="text-sm text-gray-700 mt-2 bg-gray-50 border border-gray-200 rounded p-2">{queryResult}</p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-300 flex-1 overflow-y-auto">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="text-blue-500" size={20} />
              <h3 className="font-semibold">Region Data from `/ws`</h3>
            </div>

            {selectedRegionIndex === null ? (
              <p className="text-sm text-gray-500">Click a region to inspect backend indices.</p>
            ) : (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-blue-900">Region {selectedRegionIndex + 1}</div>
                <div className="text-xs text-gray-600">Node count: {selectedRegionNodeCount}</div>
                <div className="text-xs bg-blue-50 border border-blue-200 p-2 rounded break-all">
                  Indices: {JSON.stringify(regions[selectedRegionIndex] ?? [])}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 flex flex-col bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare className="text-blue-500" size={20} />
            <h2 className="font-semibold">Operational Map (`locations` + `regions`)</h2>
          </div>
          <div className="flex-1">
            <MapCanvas
              locations={locations}
              regions={regions}
              onRegionClick={(regionIndex) => setSelectedRegionIndex(regionIndex)}
              highlightedRegion={selectedRegionIndex}
            />
          </div>
          <div className="mt-4 flex items-center gap-6 text-sm text-gray-600">
            <span>Locations: {locations.length}</span>
            <span>Regions: {regions.length}</span>
            <span>Location: {locationState}</span>
          </div>
          <button
            type="button"
            onClick={() => setLocationRetryKey((value) => value + 1)}
            className="mt-2 w-fit px-3 py-1.5 text-xs bg-gray-100 border border-gray-300 rounded hover:bg-gray-200"
          >
            Retry location
          </button>
        </div>

        <div className="w-96">
          <ChatPanel
            messages={messages}
            currentUserId={clientId}
            currentUserType="Responder"
            onSendMessage={handleSendMessage}
            showBroadcast
          />
        </div>
      </div>
    </div>
  )
}
