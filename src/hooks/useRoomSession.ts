import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildRoomUrl, createClientId } from '../lib/room'
import {
  createSignalingTransport,
  type SignalMessage,
  type SignalingTransport,
} from '../lib/signaling'
import {
  attachBitrateHint,
  createPeerConnection,
  getCapturePreset,
  startScreenCapture,
  type CapturePresetId,
} from '../lib/webrtc'

export type RoomMode = 'idle' | 'viewer' | 'broadcaster'

type PeerState = {
  id: string
  connectionState: RTCPeerConnectionState
  createdAt: number
  remoteDescriptionSet: boolean
}

type StatsState = {
  rttMs?: number
  outboundBitrateKbps?: number
  inboundBitrateKbps?: number
  candidatePair?: string
}

type SessionState = {
  clientId: string
  roomId: string | null
  roomUrl: string | null
  transportKind: SignalingTransport['kind'] | null
  mode: RoomMode
  hostId: string | null
  isSharing: boolean
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  peers: PeerState[]
  stats: StatsState
  error: string | null
  statusMessage: string
}

const pendingJoinIntervalMs = 2500
const hostAnnouncementIntervalMs = 5000
const statsPollIntervalMs = 2000

export function useRoomSession(roomId: string | null) {
  const clientId = useMemo(() => createClientId(), [])
  const transportRef = useRef<SignalingTransport | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const pendingJoinTimerRef = useRef<number | null>(null)
  const hostHeartbeatTimerRef = useRef<number | null>(null)
  const statsTimerRef = useRef<number | null>(null)
  const modeRef = useRef<RoomMode>('idle')
  const hostIdRef = useRef<string | null>(null)
  const hostPrefersH264Ref = useRef<boolean>(false)
  const selectedPresetRef = useRef<CapturePresetId>('balanced')

  const [state, setState] = useState<SessionState>({
    clientId,
    roomId,
    roomUrl: roomId ? buildRoomUrl(roomId) : null,
    transportKind: null,
    mode: 'idle',
    hostId: null,
    isSharing: false,
    localStream: null,
    remoteStream: null,
    peers: [],
    stats: {},
    error: null,
    statusMessage: roomId ? 'Connecting to room...' : 'Choose a room to begin.',
  })

  const syncState = useCallback((updater: (current: SessionState) => SessionState) => {
    setState((current) => {
      const next = updater(current)
      modeRef.current = next.mode
      hostIdRef.current = next.hostId
      return next
    })
  }, [])

  const updatePeers = useCallback((updater: (current: PeerState[]) => PeerState[]) => {
    setState((current) => ({
      ...current,
      peers: updater(current.peers),
    }))
  }, [])

  const resetTimers = () => {
    if (pendingJoinTimerRef.current) {
      window.clearInterval(pendingJoinTimerRef.current)
      pendingJoinTimerRef.current = null
    }

    if (hostHeartbeatTimerRef.current) {
      window.clearInterval(hostHeartbeatTimerRef.current)
      hostHeartbeatTimerRef.current = null
    }

    if (statsTimerRef.current) {
      window.clearInterval(statsTimerRef.current)
      statsTimerRef.current = null
    }
  }

  const closeConnections = () => {
    for (const connection of peerConnectionsRef.current.values()) {
      connection.close()
    }

    peerConnectionsRef.current.clear()
  }

  const sendSignal = useCallback((message: Omit<SignalMessage, 'createdAt' | 'roomId' | 'from'>) => {
    const transport = transportRef.current
    if (!transport || !roomId) {
      return
    }

    transport.send({
      ...message,
      roomId,
      from: clientId,
      createdAt: Date.now(),
    })
  }, [clientId, roomId])

  const registerConnection = useCallback((peerId: string, connection: RTCPeerConnection) => {
    peerConnectionsRef.current.set(peerId, connection)

    connection.onconnectionstatechange = () => {
      updatePeers((current) => {
        const next = current.filter((peer) => peer.id !== peerId)
        next.push({
          id: peerId,
          connectionState: connection.connectionState,
          createdAt: Date.now(),
          remoteDescriptionSet: connection.remoteDescription !== null,
        })
        return next
      })
    }

    connection.onicecandidate = (event) => {
      if (!event.candidate) {
        return
      }

      sendSignal({
        type: 'ice',
        to: peerId,
        payload: event.candidate.toJSON(),
      })
    }
  }, [sendSignal, updatePeers])

  const connectBroadcasterToViewer = useCallback(async (viewerId: string) => {
    const existing = peerConnectionsRef.current.get(viewerId)
    if (existing) {
      return
    }

    const connection = createPeerConnection()
    registerConnection(viewerId, connection)

    const stream = localStreamRef.current
    if (stream) {
      for (const track of stream.getTracks()) {
        const sender = connection.addTrack(track, stream)
        if (track.kind === 'video') {
          attachBitrateHint(sender, getCapturePreset(selectedPresetRef.current).maxBitrate).catch((error) => {
            console.error('[webrtc] Failed to apply bitrate hint', {
              roomId,
              viewerId,
              error,
            })
          })
        }
      }
    }

    // If broadcaster requested hardware-friendly codec preference, prefer H264.
    if (selectedPresetRef.current === 'quality') {
      try {
        const caps = RTCRtpSender.getCapabilities('video')
        const h264 = caps?.codecs?.filter((c) => /h264/i.test(String(c.mimeType))) ?? []
        if (h264.length) {
          for (const transceiver of connection.getTransceivers()) {
            try {
              // Only apply to video transceivers
              if (transceiver.sender && transceiver.sender.track?.kind === 'video') {
                transceiver.setCodecPreferences(h264 as any)
              }
            } catch (err) {
              // Non-fatal
            }
          }
        }
      } catch (err) {
        // Ignore if not supported
      }
    }

    const offer = await connection.createOffer()
    await connection.setLocalDescription(offer)

    sendSignal({
      type: 'offer',
      to: viewerId,
      payload: offer,
    })
  }, [registerConnection, roomId, sendSignal])

  const handleIncomingOffer = useCallback(async (message: SignalMessage) => {
    const from = message.from
    const offer = message.payload as RTCSessionDescriptionInit | undefined
    if (!offer) {
      return
    }

    let connection = peerConnectionsRef.current.get(from)
    if (!connection) {
      connection = createPeerConnection()
      registerConnection(from, connection)

      connection.ontrack = (event) => {
        const [stream] = event.streams
        if (stream) {
          syncState((current) => ({
            ...current,
            remoteStream: stream,
            hostId: from,
            statusMessage: 'Connected to the room.',
          }))
        }
      }
    }

    // If host announced a preference for H264 (hardware-friendly), try to prefer it.
    if (hostPrefersH264Ref.current) {
      try {
        const caps = RTCRtpSender.getCapabilities('video')
        const h264 = caps?.codecs?.filter((c) => /h264/i.test(String(c.mimeType))) ?? []
        if (h264.length) {
          for (const transceiver of connection.getTransceivers()) {
            try {
              if (transceiver.receiver || transceiver.sender) {
                const kind = transceiver.sender?.track?.kind ?? transceiver.receiver?.track?.kind
                if (kind === 'video') {
                  transceiver.setCodecPreferences(h264 as any)
                }
              }
            } catch (err) {
              // ignore
            }
          }
        }
      } catch (err) {
        // ignore
      }
    }

    hostIdRef.current = from
    await connection.setRemoteDescription(offer)
    const answer = await connection.createAnswer()
    await connection.setLocalDescription(answer)

    syncState((current) => ({
      ...current,
      hostId: from,
      statusMessage: 'Answering broadcaster...',
    }))

    sendSignal({
      type: 'answer',
      to: from,
      payload: answer,
    })
  }, [registerConnection, sendSignal, syncState])

  const handleIncomingAnswer = useCallback(async (message: SignalMessage) => {
    const connection = peerConnectionsRef.current.get(message.from)
    const answer = message.payload as RTCSessionDescriptionInit | undefined
    if (!connection || !answer) {
      return
    }

    await connection.setRemoteDescription(answer)
    updatePeers((current) => {
      const next = current.filter((peer) => peer.id !== message.from)
      next.push({
        id: message.from,
        connectionState: connection.connectionState,
        createdAt: Date.now(),
        remoteDescriptionSet: true,
      })
      return next
    })
  }, [updatePeers])

  const handleIceCandidate = useCallback(async (message: SignalMessage) => {
    const candidate = message.payload as RTCIceCandidateInit | undefined
    if (!candidate) {
      return
    }

    const connection = peerConnectionsRef.current.get(message.from)
    if (connection) {
      await connection.addIceCandidate(candidate)
    }
  }, [])

  const handleSignalMessage = useCallback((message: SignalMessage) => {
    if (!roomId || message.roomId !== roomId || message.from === clientId) {
      return
    }

    if (message.type === 'host-online') {
      // Record whether the host prefers an H264 (hardware-friendly) codec.
      try {
        const payload = message.payload as any
        hostPrefersH264Ref.current = Boolean(payload?.preferH264)
      } catch (err) {
        hostPrefersH264Ref.current = false
      }

      syncState((current) => ({
        ...current,
        hostId: message.from,
        statusMessage: current.mode === 'viewer' ? 'Broadcaster found. Connecting...' : current.statusMessage,
      }))
      return
    }

    if (message.type === 'join-request' && modeRef.current === 'broadcaster' && localStreamRef.current) {
      void connectBroadcasterToViewer(message.from).catch((error) => {
        console.error('[webrtc] Failed to connect broadcaster to viewer', {
          roomId,
          viewerId: message.from,
          error,
        })
      })
      return
    }

    if (message.type === 'offer' && modeRef.current === 'viewer') {
      void handleIncomingOffer(message).catch((error) => {
        console.error('[webrtc] Failed to handle incoming offer', {
          roomId,
          from: message.from,
          error,
        })
      })
      return
    }

    if (message.type === 'answer' && modeRef.current === 'broadcaster') {
      void handleIncomingAnswer(message).catch((error) => {
        console.error('[webrtc] Failed to handle incoming answer', {
          roomId,
          from: message.from,
          error,
        })
      })
      return
    }

    if (message.type === 'ice') {
      void handleIceCandidate(message).catch((error) => {
        console.error('[webrtc] Failed to add ICE candidate', {
          roomId,
          from: message.from,
          error,
        })
      })
    }
  }, [clientId, connectBroadcasterToViewer, handleIceCandidate, handleIncomingAnswer, handleIncomingOffer, roomId, syncState])

  useEffect(() => {
    resetTimers()
    closeConnections()
    localStreamRef.current = null
    transportRef.current?.close()
    transportRef.current = null

    syncState(() => ({
      clientId,
      roomId,
      roomUrl: roomId ? buildRoomUrl(roomId) : null,
      transportKind: null,
      mode: 'idle',
      hostId: null,
      isSharing: false,
      localStream: null,
      remoteStream: null,
      peers: [],
      stats: {},
      error: null,
      statusMessage: roomId ? 'Connecting to room...' : 'Choose a room to begin.',
    }))

    if (!roomId) {
      return undefined
    }

    const transport = createSignalingTransport(roomId, clientId, handleSignalMessage)
    transportRef.current = transport

    syncState((current) => ({
      ...current,
      transportKind: transport.kind,
      statusMessage:
        transport.kind === 'broadcast-channel'
          ? 'Using local broadcast signaling for same-browser tabs only. Set VITE_SIGNALING_URL for other browsers or devices.'
          : 'Connecting through the signaling service...',
    }))

    transport.send({
      type: 'hello',
      roomId,
      from: clientId,
      createdAt: Date.now(),
      role: 'system',
    })

    return () => {
      resetTimers()
      closeConnections()
      transport.close()
      transportRef.current = null

      const stream = localStreamRef.current
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop()
        }
      }

      localStreamRef.current = null
    }
  }, [clientId, handleSignalMessage, roomId, syncState])

  useEffect(() => {
    if (!roomId || state.mode !== 'viewer') {
      if (pendingJoinTimerRef.current) {
        window.clearInterval(pendingJoinTimerRef.current)
        pendingJoinTimerRef.current = null
      }
      return undefined
    }

    const sendJoinRequest = () => {
      sendSignal({
        type: 'join-request',
        payload: { mode: 'viewer' },
      })
    }

    sendJoinRequest()
    pendingJoinTimerRef.current = window.setInterval(sendJoinRequest, pendingJoinIntervalMs)

    return () => {
      if (pendingJoinTimerRef.current) {
        window.clearInterval(pendingJoinTimerRef.current)
        pendingJoinTimerRef.current = null
      }
    }
  }, [roomId, sendSignal, state.mode])

  useEffect(() => {
    if (!roomId || state.mode !== 'broadcaster' || !state.isSharing) {
      if (hostHeartbeatTimerRef.current) {
        window.clearInterval(hostHeartbeatTimerRef.current)
        hostHeartbeatTimerRef.current = null
      }
      return undefined
    }

    const sendHostHeartbeat = () => {
      sendSignal({
          type: 'host-online',
          role: 'broadcaster',
          payload: { preferH264: selectedPresetRef.current === 'quality' },
      })
    }

    sendHostHeartbeat()
    hostHeartbeatTimerRef.current = window.setInterval(sendHostHeartbeat, hostAnnouncementIntervalMs)

    return () => {
      if (hostHeartbeatTimerRef.current) {
        window.clearInterval(hostHeartbeatTimerRef.current)
        hostHeartbeatTimerRef.current = null
      }
    }
  }, [roomId, sendSignal, state.isSharing, state.mode])

  useEffect(() => {
    if (!roomId || state.mode === 'idle') {
      if (statsTimerRef.current) {
        window.clearInterval(statsTimerRef.current)
        statsTimerRef.current = null
      }
      return undefined
    }

    statsTimerRef.current = window.setInterval(() => {
      const connection = peerConnectionsRef.current.values().next().value as RTCPeerConnection | undefined
      if (!connection) {
        return
      }

      void connection.getStats().then((reports) => {
        let rttMs: number | undefined
        let outboundBitrateKbps: number | undefined
        let inboundBitrateKbps: number | undefined
        let candidatePair: string | undefined

        reports.forEach((report) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded' && 'currentRoundTripTime' in report) {
            rttMs = Number(report.currentRoundTripTime) * 1000
            candidatePair = `${String(report.localCandidateId ?? 'local')} → ${String(report.remoteCandidateId ?? 'remote')}`
          }

          if (report.type === 'outbound-rtp' && report.kind === 'video') {
            outboundBitrateKbps = (Number(report.bytesSent ?? 0) * 8) / 1000
          }

          if (report.type === 'inbound-rtp' && report.kind === 'video') {
            inboundBitrateKbps = (Number(report.bytesReceived ?? 0) * 8) / 1000
          }
        })

        setState((current) => ({
          ...current,
          stats: {
            rttMs,
            outboundBitrateKbps,
            inboundBitrateKbps,
            candidatePair,
          },
        }))
      }).catch((error) => {
        console.error('[webrtc] Failed to read connection stats', {
          roomId,
          error,
        })
      })
    }, statsPollIntervalMs)

    return () => {
      if (statsTimerRef.current) {
        window.clearInterval(statsTimerRef.current)
        statsTimerRef.current = null
      }
    }
  }, [roomId, state.mode])

  const stopBroadcast = useCallback(async () => {
    const stream = localStreamRef.current
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop()
      }
    }

    localStreamRef.current = null
    resetTimers()
    closeConnections()
    sendSignal({ type: 'leave' })

    syncState((current) => ({
      ...current,
      mode: 'idle',
      isSharing: false,
      localStream: null,
      remoteStream: null,
      peers: [],
      stats: {},
      hostId: null,
      statusMessage: 'Broadcast stopped.',
    }))
  }, [sendSignal, syncState])

  const startBroadcaster = useCallback(async (presetId: CapturePresetId) => {
    if (!roomId) {
      return
    }

    try {
      selectedPresetRef.current = presetId
      syncState((current) => ({
        ...current,
        mode: 'broadcaster',
        statusMessage: 'Requesting screen capture...',
        error: null,
      }))

      const stream = await startScreenCapture(getCapturePreset(presetId))
      localStreamRef.current = stream

      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        void stopBroadcast()
      })

      syncState((current) => ({
        ...current,
        localStream: stream,
        isSharing: true,
        statusMessage: 'Screen share is live. Waiting for viewers...',
      }))

      sendSignal({
          type: 'host-online',
          role: 'broadcaster',
          payload: { preferH264: selectedPresetRef.current === 'quality' },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Screen capture failed.'
      console.error('[capture] Screen capture failed', {
        roomId,
        presetId,
        error,
      })
      syncState((current) => ({
        ...current,
        mode: 'idle',
        isSharing: false,
        localStream: null,
        error: message,
        statusMessage: 'Screen capture was not started.',
      }))
    }
  }, [roomId, sendSignal, stopBroadcast, syncState])

  const joinAsViewer = useCallback(() => {
    if (!roomId) {
      return
    }

    syncState((current) => ({
      ...current,
      mode: 'viewer',
      statusMessage: 'Looking for a broadcaster in this room...',
      error: null,
    }))
  }, [roomId, syncState])

  const leaveRoom = useCallback(() => {
    void stopBroadcast()
    if (window.location.pathname !== '/') {
      window.history.pushState(null, '', new URL('.', window.location.href).toString())
    }
  }, [stopBroadcast])

  return {
    state,
    startBroadcaster,
    joinAsViewer,
    stopBroadcast,
    leaveRoom,
  }
}
