import { useEffect, useState } from 'react'
import { buildRoomUrl, createRoomId, getRoomIdFromPath } from './lib/room'
import { useRoomSession } from './hooks/useRoomSession'
import './App.css'

const shareOptions = [
  { label: 'CPU decoder', preset: 'fast' as const },
  { label: 'GPU decoder', preset: 'quality' as const },
]

function App() {
  const [selectedDecoder, setSelectedDecoder] = useState<'fast' | 'quality'>('fast')
  const [activeRoomId, setActiveRoomId] = useState<string | null>(() =>
    getRoomIdFromPath(window.location.pathname),
  )

  const session = useRoomSession(activeRoomId)
  const { joinAsViewer, startBroadcaster, state } = session
  const roomMode = state.mode

  useEffect(() => {
    const handlePopState = () => {
      setActiveRoomId(getRoomIdFromPath(window.location.pathname))
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    if (activeRoomId && roomMode === 'idle') {
      joinAsViewer()
    }
  }, [activeRoomId, joinAsViewer, roomMode])

  useEffect(() => {
    if (activeRoomId) {
      return
    }

    const roomId = createRoomId()
    const nextUrl = buildRoomUrl(roomId)
    window.location.replace(nextUrl)
  }, [activeRoomId])

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="room-label">
          <span>Room</span>
          <strong>{state.roomId ?? 'creating...'}</strong>
        </div>
        <button
          type="button"
          className="copy-button"
          onClick={async () => {
            if (state.roomUrl) {
              await navigator.clipboard.writeText(state.roomUrl)
            }
          }}
          disabled={!state.roomUrl}
        >
          Copy room link
        </button>
      </header>

      <section className="content-area">
        <p className="status-text">{state.statusMessage}</p>
        {state.error ? <p className="error-text">{state.error}</p> : null}

        {(state.localStream || state.remoteStream) ? (
          <div className="video-stack">
            {state.localStream ? (
              <div className="video-box">
                <span>Local</span>
                <video ref={(element) => { if (element) element.srcObject = state.localStream }} autoPlay muted playsInline />
              </div>
            ) : null}

            {state.remoteStream ? (
              <div className="video-box">
                <span>Remote</span>
                <video ref={(element) => { if (element) element.srcObject = state.remoteStream }} autoPlay playsInline />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <footer className="bottom-bar">
        <label className="decoder-select-wrap">
          <span>Decoder</span>
          <select
            className="decoder-select"
            value={selectedDecoder}
            onChange={(event) => setSelectedDecoder(event.target.value as 'fast' | 'quality')}
          >
            {shareOptions.map((option) => (
              <option key={option.preset} value={option.preset}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="share-button"
          onClick={() => void startBroadcaster(selectedDecoder)}
        >
          Choose window or app to share
        </button>
      </footer>
    </main>
  )
}

export default App
