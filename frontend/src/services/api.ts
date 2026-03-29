const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000'
const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? 'ws://localhost:8000/ws'
const CONNECT_TIMEOUT_MS = 4000
const CLIENT_ID_TIMEOUT_MS = 4000
const LOCATION_INTERVAL_MS = 5000
const MAX_RECONNECT_ATTEMPTS = 10
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 15000
const RECONNECT_JITTER_MS = 250

export type Role = 'user' | 'responder'
export type LocationTuple = [number, number, number?]
export type RegionPointTuple = [number, number, number]

export interface RegionPolygon {
  points: Array<[number, number]>
  priority: number
  relativePriority: number
  pointCount: number
}

interface ClientIdMessage {
  client_id: string
}

interface BroadcastMessage {
  locations?: unknown
  regions?: unknown
  region_debug?: unknown
}

interface ResponderMessage {
  responder_message: string
}

export interface BackendData {
  locations: LocationTuple[]
  regions: RegionPolygon[]
  regionDebug?: {
    usersTotal: number
    usersValidForRegions: number
    respondersTotal: number
    respondersValidForMap: number
    regionsCount: number
    activeConnections: number
  }
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
  role?: Role
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
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false

  if (value.length >= 3 && value[2] !== undefined && value[2] !== null) {
    const role = Number(value[2])
    if (!Number.isFinite(role)) return false
  }

  return true
}

function isBroadcastMessage(value: unknown): value is BroadcastMessage {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<BroadcastMessage>

  return Array.isArray(candidate.locations)
}

function normalizeLocationTuple(value: unknown): LocationTuple | null {
  if (!isLocationTuple(value)) return null
  const lat = Number(value[0])
  const lon = Number(value[1])
  const role = value.length >= 3 && value[2] !== undefined && value[2] !== null
    ? Number(value[2])
    : undefined

  return role === undefined ? [lat, lon] : [lat, lon, role]
}

function normalizeRegionPointTuple(value: unknown): RegionPointTuple | null {
  if (!Array.isArray(value) || value.length < 3) return null
  const lat = Number(value[0])
  const lon = Number(value[1])
  const priority = Number(value[2])
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(priority)) return null
  return [lat, lon, priority]
}

function normalizeRegion(rawRegion: unknown): Omit<RegionPolygon, 'relativePriority'> | null {
  if (!Array.isArray(rawRegion)) return null

  const tuples = rawRegion
    .map((entry) => normalizeRegionPointTuple(entry))
    .filter((entry): entry is RegionPointTuple => entry !== null)

  if (tuples.length === 0) return null

  const points = tuples.map(([lat, lon]) => [lat, lon] as [number, number])
  const priority = tuples.reduce((sum, tuple) => sum + tuple[2], 0) / tuples.length

  return {
    points,
    priority,
    pointCount: tuples.length,
  }
}

function normalizeBroadcastData(value: BroadcastMessage): BackendData | null {
  if (!Array.isArray(value.locations)) return null

  const normalizedLocations = value.locations
    .map((entry) => normalizeLocationTuple(entry))

  if (normalizedLocations.some((entry) => entry === null)) return null

  const locations = normalizedLocations as LocationTuple[]

  const regionBases = Array.isArray(value.regions)
    ? value.regions
      .map((entry) => normalizeRegion(entry))
      .filter((entry): entry is Omit<RegionPolygon, 'relativePriority'> => entry !== null)
    : []

  const averagePriority = regionBases.length > 0
    ? regionBases.reduce((sum, region) => sum + region.priority, 0) / regionBases.length
    : 0

  const regions: RegionPolygon[] = regionBases.map((region) => ({
    ...region,
    relativePriority: region.priority - averagePriority,
  }))

  const regionDebugRaw = value.region_debug
  const regionDebug = typeof regionDebugRaw === 'object' && regionDebugRaw !== null
    ? {
      usersTotal: Number((regionDebugRaw as { users_total?: unknown }).users_total ?? 0),
      usersValidForRegions: Number((regionDebugRaw as { users_valid_for_regions?: unknown }).users_valid_for_regions ?? 0),
      respondersTotal: Number((regionDebugRaw as { responders_total?: unknown }).responders_total ?? 0),
      respondersValidForMap: Number((regionDebugRaw as { responders_valid_for_map?: unknown }).responders_valid_for_map ?? 0),
      regionsCount: Number((regionDebugRaw as { regions_count?: unknown }).regions_count ?? 0),
      activeConnections: Number((regionDebugRaw as { active_connections?: unknown }).active_connections ?? 0),
    }
    : undefined

  return {
    locations,
    regions,
    regionDebug,
  }
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

function waitForClientId(socket: WebSocket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('Client id timeout'))
    }, timeoutMs)

    const cleanup = () => {
      window.clearTimeout(timer)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('close', handleClose)
      socket.removeEventListener('error', handleError)
    }

    const handleMessage = (event: MessageEvent) => {
      const parsed = parseMessage(event.data)
      if (!isClientIdMessage(parsed)) return

      cleanup()
      resolve(parsed.client_id)
    }

    const handleClose = () => {
      cleanup()
      reject(new Error('Socket closed before receiving client id'))
    }

    const handleError = () => {
      cleanup()
      reject(new Error('Socket errored before receiving client id'))
    }

    socket.addEventListener('message', handleMessage)
    socket.addEventListener('close', handleClose, { once: true })
    socket.addEventListener('error', handleError, { once: true })
  })
}

function getReconnectDelayMs(attempt: number): number {
  const exponential = Math.min(RECONNECT_BASE_DELAY_MS * (2 ** Math.max(attempt - 1, 0)), RECONNECT_MAX_DELAY_MS)
  const jitter = Math.floor(Math.random() * RECONNECT_JITTER_MS)
  return exponential + jitter
}

async function postToBackend(path: string, payload: BackendPostPayload): Promise<Response> {
  const queryParams = new URLSearchParams()

  queryParams.set('client_id', payload.client_id)
  if (typeof payload.content === 'string') {
    queryParams.set('content', payload.content)
  }
  if (typeof payload.role === 'string') {
    queryParams.set('role', payload.role)
  }

  const queryString = queryParams.toString()
  const url = queryString
    ? `${API_BASE_URL}${path}?${queryString}`
    : `${API_BASE_URL}${path}`

  return fetch(url, {
    method: 'POST',
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

export async function switchRole(clientId: string, role: Role): Promise<void> {
  await postToBackend('/switch', { client_id: clientId, role })
}

export async function sendMessage(clientId: string, content: string, role: Role): Promise<void> {
  await postToBackend('/message', { client_id: clientId, content, role })
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
  let currentLocation = options.location ?? null
  let activeSocket: WebSocket | null = null
  let locationIntervalId: number | null = null
  let reconnectTimerId: number | null = null
  let manuallyClosed = false
  let isConnecting = false
  let reconnectAttempts = 0

  const clearLocationUpdates = () => {
    if (locationIntervalId !== null) {
      window.clearInterval(locationIntervalId)
      locationIntervalId = null
    }
  }

  const clearReconnectTimer = () => {
    if (reconnectTimerId !== null) {
      window.clearTimeout(reconnectTimerId)
      reconnectTimerId = null
    }
  }

  const startLocationUpdates = () => {
    clearLocationUpdates()

    locationIntervalId = window.setInterval(() => {
      if (!currentLocation || !activeSocket || activeSocket.readyState !== WebSocket.OPEN) return
      activeSocket.send(JSON.stringify(currentLocation))
    }, LOCATION_INTERVAL_MS)
  }

  const scheduleReconnect = (reason: string) => {
    if (manuallyClosed) return
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      options.onDisconnect?.('Realtime connection closed after max reconnect attempts')
      return
    }

    reconnectAttempts += 1
    const delayMs = getReconnectDelayMs(reconnectAttempts)
    options.onDisconnect?.(`${reason}. Reconnecting (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`)

    clearReconnectTimer()
    reconnectTimerId = window.setTimeout(() => {
      reconnectTimerId = null
      void connectSocket()
    }, delayMs)
  }

  const connectSocket = async () => {
    if (manuallyClosed || isConnecting) return
    isConnecting = true

    try {
      const socket = new WebSocket(WS_URL)
      await waitForOpen(socket, CONNECT_TIMEOUT_MS)
      const clientId = await waitForClientId(socket, CLIENT_ID_TIMEOUT_MS)

      if (manuallyClosed) {
        socket.close()
        return
      }

      activeSocket = socket
      reconnectAttempts = 0

      await switchRole(clientId, options.role)
      options.onClientId(clientId)

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
          const normalized = normalizeBroadcastData(parsed)
          if (normalized) {
            options.onData(normalized)
          }
          return
        }

        if (isResponderMessage(parsed)) {
          options.onResponderMessage?.(parsed.responder_message)
          return
        }

        // Non-JSON text messages are informational broadcasts from backend.
      })

      socket.addEventListener('close', () => {
        if (activeSocket === socket) {
          activeSocket = null
        }
        clearLocationUpdates()
        if (manuallyClosed) {
          options.onDisconnect?.('Realtime connection closed')
          return
        }
        scheduleReconnect('Realtime connection lost')
      })

      socket.addEventListener('error', () => {
        options.onError?.('WebSocket encountered an error')
      })
    } catch {
      clearLocationUpdates()
      scheduleReconnect('Failed to establish realtime connection')
    } finally {
      isConnecting = false
    }
  }

  await connectSocket()

  return {
    close: () => {
      manuallyClosed = true
      clearReconnectTimer()
      clearLocationUpdates()
      if (activeSocket && activeSocket.readyState <= WebSocket.OPEN) {
        activeSocket.close()
      }
      activeSocket = null
    },
    sendLocation: (location: LocationTuple) => {
      currentLocation = location
      if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
        activeSocket.send(JSON.stringify(location))
      }
    },
  }
}
