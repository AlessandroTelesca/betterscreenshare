export type CapturePresetId = 'fast' | 'balanced' | 'quality'

export type CapturePreset = {
  id: CapturePresetId
  label: string
  description: string
  width: number
  height: number
  frameRate: number
  maxBitrate: number
}

export const capturePresets: CapturePreset[] = [
  {
    id: 'fast',
    label: 'Fast',
    description: 'Lower resolution and frame rate for slow CPUs.',
    width: 960,
    height: 540,
    frameRate: 15,
    maxBitrate: 1_200_000,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'A good default for most systems.',
    width: 1280,
    height: 720,
    frameRate: 24,
    maxBitrate: 2_500_000,
  },
  {
    id: 'quality',
    label: 'Quality',
    description: 'Sharper output when the machine can handle it.',
    width: 1920,
    height: 1080,
    frameRate: 30,
    maxBitrate: 4_500_000,
  },
]

export function getCapturePreset(id: CapturePresetId): CapturePreset {
  return capturePresets.find((preset) => preset.id === id) ?? capturePresets[1]
}

export function buildDisplayMediaOptions(preset: CapturePreset): DisplayMediaStreamOptions {
  return {
    video: {
      width: { ideal: preset.width },
      height: { ideal: preset.height },
      frameRate: { ideal: preset.frameRate, max: preset.frameRate },
    },
    audio: false,
    surfaceSwitching: 'include',
    preferCurrentTab: false,
    monitorTypeSurfaces: 'include',
  } as DisplayMediaStreamOptions
}

export function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  })
}

export async function attachBitrateHint(sender: RTCRtpSender, maxBitrate: number): Promise<void> {
  const parameters = sender.getParameters()
  parameters.encodings = parameters.encodings?.length
    ? parameters.encodings.map((encoding) => ({ ...encoding, maxBitrate }))
    : [{ maxBitrate }]

  await sender.setParameters(parameters)
}

export async function startScreenCapture(preset: CapturePreset): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia(buildDisplayMediaOptions(preset))

  const track = stream.getVideoTracks()[0]
  if (track) {
    track.contentHint = 'detail'
  }

  return stream
}