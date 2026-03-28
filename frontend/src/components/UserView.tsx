import { useEffect, useMemo, useState } from 'react'
import { User, MapPin } from 'lucide-react'
import { ChatPanel, type ChatMessage } from './ChatPanel'
import { MapCanvas } from './MapCanvas'
import {
  connectRealtimeSession,
  sendMessage,
  type LocationTuple,
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

export default function UserView() {
  const [clientId, setClientId] = useState('connecting...')
  const [connectionState, setConnectionState] = useState('Connecting')
  const [locationState, setLocationState] = useState('Locating')
  const [locationRetryKey, setLocationRetryKey] = useState(0)
  const [locations, setLocations] = useState<LocationTuple[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
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
          role: 'user',
          location,
          onClientId: (id) => {
            if (!mounted) return
            setClientId(id)
            setConnectionState('Connected')
          },
          onData: (data) => {
            if (!mounted) return
            setLocations(data.locations)
          },
          onResponderMessage: (content) => {
            if (!mounted) return
            setMessages((previous) => [...previous, {
              id: `responder-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              from: 'Responder',
              to: 'broadcast',
              content,
              timestamp: new Date(),
              fromType: 'Responder',
            }])
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
      fromType: 'User',
    }

    setMessages((previous) => [...previous, outgoingMessage])

    try {
      await sendMessage(clientId, content)
    } catch {
      setMessages((previous) => [...previous, {
        id: `system-${Date.now()}`,
        from: 'system',
        to: clientId,
        content: 'Failed to deliver message to backend /message endpoint.',
        timestamp: new Date(),
        fromType: 'System',
      }])
    }
  }

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      <header className="bg-white border-b border-gray-300 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <User className="text-blue-500" size={28} />
            <div>
              <h1 className="text-xl font-semibold">Emergency Response - User Portal</h1>
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
        <div className="flex-1 flex flex-col bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center gap-2 mb-4">
            <MapPin className="text-blue-500" size={20} />
            <h2 className="font-semibold">Live Locations from `/ws`</h2>
          </div>
          <div className="flex-1">
            <MapCanvas locations={locations} />
          </div>
          <div className="mt-4 text-sm text-gray-600">Active map points: {locations.length}</div>
          <div className="mt-1 text-sm text-gray-600">Location: {locationState}</div>
          <button
            type="button"
            onClick={() => setLocationRetryKey((value) => value + 1)}
            className="mt-2 w-fit px-3 py-1.5 text-xs bg-gray-100 border border-gray-300 rounded hover:bg-gray-200"
          >
            Retry location
          </button>
        </div>

        <div className="w-96 flex flex-col">
          <ChatPanel
            messages={messages}
            currentUserId={clientId}
            currentUserType="User"
            onSendMessage={handleSendMessage}
          />

          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900 mb-2">Connected Backend Features</h3>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>• WebSocket handshake for `client_id`</li>
              <li>• WebSocket broadcast for `locations` and `regions`</li>
              <li>• HTTP post to `/message` when you send chat text</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
