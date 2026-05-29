import { WebSocketServer } from 'ws'

const port = Number(process.env.SIGNALING_PORT ?? 8787)
const rooms = new Map()

function getRoom(roomId) {
  let room = rooms.get(roomId)
  if (!room) {
    room = new Map()
    rooms.set(roomId, room)
  }

  return room
}

function broadcast(room, message, excludeSocket) {
  const payload = JSON.stringify(message)

  for (const socket of room.values()) {
    if (socket === excludeSocket) {
      continue
    }

    if (socket.readyState === socket.OPEN) {
      socket.send(payload)
    }
  }
}

const server = new WebSocketServer({ port })

server.on('connection', (socket, request) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const roomId = url.searchParams.get('roomId')
  const clientId = url.searchParams.get('clientId')

  if (!roomId || !clientId) {
    socket.close(1008, 'Missing roomId or clientId')
    return
  }

  const room = getRoom(roomId)
  room.set(clientId, socket)

  socket.on('message', (data) => {
    try {
      const message = JSON.parse(String(data))
      if (!message || message.roomId !== roomId) {
        return
      }

      if (typeof message.to === 'string' && room.has(message.to)) {
        const target = room.get(message.to)
        if (target && target.readyState === target.OPEN) {
          target.send(JSON.stringify(message))
        }
        return
      }

      broadcast(room, message, socket)
    } catch (error) {
      console.error('[signaling] Failed to relay message', { roomId, clientId, error })
    }
  })

  socket.on('close', () => {
    room.delete(clientId)
    if (room.size === 0) {
      rooms.delete(roomId)
      return
    }

    broadcast(room, {
      type: 'leave',
      roomId,
      from: clientId,
      createdAt: Date.now(),
    })
  })
})

server.on('listening', () => {
  console.log(`[signaling] WebSocket relay listening on ws://localhost:${port}`)
})

server.on('error', (error) => {
  console.error('[signaling] Server error', error)
  process.exitCode = 1
})