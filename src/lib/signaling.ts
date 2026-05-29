export type SignalingRole = 'broadcaster' | 'viewer' | 'system'

export type SignalMessageType =
  | 'hello'
  | 'host-online'
  | 'join-request'
  | 'offer'
  | 'answer'
  | 'ice'
  | 'leave'
  | 'room-state'

export type SignalMessage = {
  type: SignalMessageType
  roomId: string
  from: string
  to?: string
  role?: SignalingRole
  payload?: unknown
  createdAt: number
}

export type SignalingTransport = {
  kind: 'broadcast-channel' | 'websocket'
  send: (message: SignalMessage) => void
  close: () => void
}

export type SignalingHandler = (message: SignalMessage) => void

const websocketUrl = import.meta.env.VITE_SIGNALING_URL as string | undefined

export function createSignalingTransport(
  roomId: string,
  clientId: string,
  handler: SignalingHandler,
): SignalingTransport {
  if (websocketUrl) {
    return createWebSocketTransport(roomId, clientId, handler)
  }

  return createBroadcastChannelTransport(roomId, clientId, handler)
}

function createBroadcastChannelTransport(
  roomId: string,
  clientId: string,
  handler: SignalingHandler,
): SignalingTransport {
  const channel = new BroadcastChannel(`betterscreenshare:${roomId}`)

  channel.onmessage = (event) => {
    const message = event.data as SignalMessage
    if (message?.from === clientId) {
      return
    }

    handler(message)
  }

  return {
    kind: 'broadcast-channel',
    send: (message) => channel.postMessage(message),
    close: () => channel.close(),
  }
}

function createWebSocketTransport(
  roomId: string,
  clientId: string,
  handler: SignalingHandler,
): SignalingTransport {
  const endpoint = new URL(websocketUrl!)
  endpoint.searchParams.set('roomId', roomId)
  endpoint.searchParams.set('clientId', clientId)

  const socket = new WebSocket(endpoint.toString())
  const bufferedMessages: SignalMessage[] = []

  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(String(event.data)) as SignalMessage
      if (message?.from === clientId) {
        return
      }

      handler(message)
    } catch (error) {
      console.error('[signaling] Failed to parse incoming message', {
        roomId,
        clientId,
        data: event.data,
        error,
      })
    }
  })

  socket.addEventListener('error', (event) => {
    console.error('[signaling] WebSocket transport error', {
      roomId,
      clientId,
      event,
    })
  })

  socket.addEventListener('close', (event) => {
    if (!event.wasClean) {
      console.error('[signaling] WebSocket closed unexpectedly', {
        roomId,
        clientId,
        code: event.code,
        reason: event.reason,
      })
    }
  })

  socket.addEventListener('open', () => {
    for (const message of bufferedMessages) {
      socket.send(JSON.stringify(message))
    }

    bufferedMessages.length = 0
  })

  return {
    kind: 'websocket',
    send: (message) => {
      const payload = JSON.stringify(message)
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(payload)
        return
      }

      bufferedMessages.push(message)
    },
    close: () => socket.close(),
  }
}