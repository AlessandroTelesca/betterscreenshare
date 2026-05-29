export function createRoomId(length = 9): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let value = String((bytes[0] % 9) + 1)

  for (let index = 1; index < length; index += 1) {
    value += String(bytes[index] % 10)
  }

  return value
}

export function createClientId(): string {
  return crypto.randomUUID()
}

export function getRoomIdFromPath(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) {
    return null
  }

  const roomId = segments[segments.length - 1]
  return /^\d+$/.test(roomId) ? roomId : null
}

export function buildRoomUrl(roomId: string): string {
  return new URL(roomId, window.location.href).toString()
}