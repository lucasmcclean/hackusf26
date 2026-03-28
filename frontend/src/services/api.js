const WS_URL = 'ws://localhost:8000'
const CREATE_TIMEOUT_MS = 3000

function buildDummyActor(role, location) {
  return {
    id: `dummy-${role}-${Date.now()}`,
    class: role,
    location,
    source: 'dummy',
  }
}

function parseMessage(data) {
  if (typeof data !== 'string') return null

  try {
    return JSON.parse(data)
  } catch {
    return null
  }
}

function waitForOpen(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('WebSocket open timeout'))
    }, timeoutMs)

    function cleanup() {
      window.clearTimeout(timer)
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('error', handleError)
    }

    function handleOpen() {
      cleanup()
      resolve()
    }

    function handleError() {
      cleanup()
      reject(new Error('WebSocket open failed'))
    }

    socket.addEventListener('open', handleOpen)
    socket.addEventListener('error', handleError)
  })
}

function waitForCreateAck(socket, role, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error('Create actor timeout'))
    }, timeoutMs)

    function cleanup() {
      window.clearTimeout(timer)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('error', handleError)
      socket.removeEventListener('close', handleClose)
    }

    function handleError() {
      cleanup()
      reject(new Error('WebSocket message error'))
    }

    function handleClose() {
      cleanup()
      reject(new Error('WebSocket closed before ack'))
    }

    function handleMessage(event) {
      const parsed = parseMessage(event.data)
      if (!parsed) return

      const payload = parsed.payload || parsed
      if (payload?.id && (payload.class === role || payload.role === role)) {
        cleanup()
        resolve({
          id: payload.id,
          class: payload.class || payload.role,
          location: payload.location,
          source: 'websocket',
        })
      }
    }

    socket.addEventListener('message', handleMessage)
    socket.addEventListener('error', handleError)
    socket.addEventListener('close', handleClose)
  })
}

export async function createActor({ role, location }) {
  const payload = {
    type: 'actor.create',
    payload: {
      class: role,
      location,
    },
  }

  const socket = new WebSocket(WS_URL)

  try {
    await waitForOpen(socket, CREATE_TIMEOUT_MS)
    socket.send(JSON.stringify(payload))

    const actor = await waitForCreateAck(socket, role, CREATE_TIMEOUT_MS)
    socket.close()
    return actor
  } catch {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close()
    }

    return buildDummyActor(role, location)
  }
}

export function createUser(location) {
  return createActor({ role: 'user', location })
}

export function createResponder(location) {
  return createActor({ role: 'responder', location })
}
