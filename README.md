# BetterScreenShare

Peer-to-peer screen sharing built with Vite, React, and TypeScript for GitHub Pages.

## What it does

- Creates numeric room URLs such as `/232942498`.
- Uses native WebRTC to send screen capture directly between peers.
- Prefers browser-managed hardware acceleration by keeping the media pipeline lean and offering lower capture presets for slow CPUs.
- Falls back to `BroadcastChannel` for same-browser testing when no signaling URL is configured.

## Development

```bash
npm install
npm run dev
```

## Signaling

Set `VITE_SIGNALING_URL` to a WebSocket endpoint that relays room messages between peers. The frontend stays static on GitHub Pages, but cross-device room matching still needs signaling.

Example:

```bash
VITE_SIGNALING_URL=wss://your-signaling.example/ws
```

## GitHub Pages

The app is built with relative asset paths and includes a `404.html` redirect so deep links like `/232942498` work on Pages.

Add the workflow in `.github/workflows/deploy.yml`, then point GitHub Pages at the `github-pages` environment.

## Notes

- Screen capture requires a secure context, so GitHub Pages or another HTTPS host is required.
- WebRTC codec selection and hardware offload are browser-controlled. This app can bias the capture settings, but it cannot force GPU encode/decode.
- The first user to start sharing in a room becomes the broadcaster; other users can join as viewers.