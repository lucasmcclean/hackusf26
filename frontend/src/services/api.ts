const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000'
const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? 'ws://localhost:8000/ws'
const CONNECT_TIMEOUT_MS = 4000
const CLIENT_ID_TIMEOUT_MS = 4000
const LOCATION_INTERVAL_MS = 5000

export type Role = 'user' | 'responder'
export type LocationTuple = [number, number]
export type RegionGroup = number[]

interface ClientIdMessage {
  client_id: string
}

interface BroadcastMessage {
  locations: LocationTuple[]
  regions: RegionGroup[]
}

interface ResponderMessage {
  responder_message: string
}

export interface BackendData {
  locations: LocationTuple[]
  regions: RegionGroup[]
}

export interface SessionController {
  close: () => void
  sendLocation: (location: LocationTuple) => void
}

interface ConnectOptions {
  role: Role
  location?: LocationTuple | null
  onClientId: (clientId: string) => void
  onData: (data: BackendData) => void
  onResponderMessage?: (content: string) => void
  onDisconnect?: (reason: string) => void
  onError?: (message: string) => void
}

interface BackendPostPayload {
  client_id: string
  content?: string
}

function parseMessage(data: unknown): unknown {
  if (typeof data !== 'string') return null
  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

function isClientIdMessage(value: unknown): value is ClientIdMessage {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as Partial<ClientIdMessage>).client_id === 'string'
}

function isLocationTuple(value: unknown): value is LocationTuple {
  if (!Array.isArray(value) || value.length < 2) return false
  const lat = Number(value[0])
  const lon = Number(value[1])
  return Number.isFinite(lat) && Number.isFinite(lon)
}

function isRegionGroup(value: unknown): value is RegionGroup {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item))
}

function isBroadcastMessage(value: unknown): value is BroadcastMessage {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<BroadcastMessage>

  if (!Array.isArray(candidate.locations) || !Array.isArray(candidate.regions)) return false

  return candidate.locations.every((entry) => isLocationTuple(entry))
    && candidate.regions.every((entry) => isRegionGroup(entry))
}

function isResponderMessage(value: unknown): value is ResponderMessage {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as Partial<ResponderMessage>).responder_message === 'string'
}

function waitForOpen(socket: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('WebSocket open timeout'))
    }, timeoutMs)

    const handleOpen = () => {
      window.clearTimeout(timer)
      socket.removeEventListener('error', handleError)
      resolve()
    }

    const handleError = () => {
      window.clearTimeout(timer)
      socket.removeEventListener('open', handleOpen)
      reject(new Error('WebSocket open failed'))
    }

    socket.addEventListener('open', handleOpen, { once: true })
    socket.addEventListener('error', handleError, { once: true })
  })
}

async function postToBackend(path: string, payload: BackendPostPayload): Promise<Response> {
  return fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

export async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/`, { method: 'GET' })
    return response.ok
  } catch {
    return false
  }
}

export async function switchRole(clientId: string): Promise<void> {
  await postToBackend('/switch', { client_id: clientId })
}

export async function sendMessage(clientId: string, content: string): Promise<void> {
  await postToBackend('/message', { client_id: clientId, content })
}

export async function queryMessages(clientId: string, content: string): Promise<string> {
  const response = await postToBackend('/query', { client_id: clientId, content })

  if (!response.ok) {
    throw new Error(`Query request failed (${response.status})`)
  }

  const json = await response.json() as { content?: string }
  return typeof json.content === 'string' ? json.content : ''
}

export async function connectRealtimeSession(options: ConnectOptions): Promise<SessionController> {
  const socket = new WebSocket(WS_URL)
  let currentLocation = options.location ?? null
  let clientId = ''
  let locationIntervalId: number | null = null

  await waitForOpen(socket, CONNECT_TIMEOUT_MS)

  const startLocationUpdates = () => {
    if (locationIntervalId !== null) {
      window.clearInterval(locationIntervalId)
    }

    locationIntervalId = window.setInterval(() => {
      if (!currentLocation || socket.readyState !== WebSocket.OPEN) return
      socket.send(JSON.stringify(currentLocation))
    }, LOCATION_INTERVAL_MS)
  }

  const waitForClientId = new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('Client id timeout'))
    }, CLIENT_ID_TIMEOUT_MS)

    const handleMessage = (event: MessageEvent) => {
      const parsed = parseMessage(event.data)
      if (!isClientIdMessage(parsed)) return

      window.clearTimeout(timer)
      socket.removeEventListener('message', handleMessage)
      resolve(parsed.client_id)
    }

    socket.addEventListener('message', handleMessage)
  })

  clientId = await waitForClientId
  options.onClientId(clientId)
  void switchRole(clientId).catch(() => {
    options.onError?.('Role sync request failed, realtime stream is still active')
  })

  if (currentLocation && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(currentLocation))
  }

  startLocationUpdates()

  socket.addEventListener('message', (event) => {
    const parsed = parseMessage(event.data)

    if (isClientIdMessage(parsed)) {
      return
    }

    if (isBroadcastMessage(parsed)) {
      options.onData({
        locations: parsed.locations,
        regions: parsed.regions,
      })
      return
    }

    if (isResponderMessage(parsed)) {
      options.onResponderMessage?.(parsed.responder_message)
      return
    }

    // Non-JSON text messages are informational broadcasts from backend.
  })

  socket.addEventListener('close', () => {
    if (locationIntervalId !== null) {
      window.clearInterval(locationIntervalId)
      locationIntervalId = null
    }
    options.onDisconnect?.('Realtime connection closed')
  })

  socket.addEventListener('error', () => {
    options.onError?.('WebSocket encountered an error')
  })

  return {
    close: () => {
      if (locationIntervalId !== null) {
        window.clearInterval(locationIntervalId)
      }
      socket.close()
    },
    sendLocation: (location: LocationTuple) => {
      currentLocation = location
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(location))
      }
    },
  }
}
