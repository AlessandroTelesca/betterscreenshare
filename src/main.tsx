import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const redirectKey = 'betterscreenshare:redirect-path'
const redirectedPath = window.sessionStorage.getItem(redirectKey)

if (redirectedPath) {
  window.sessionStorage.removeItem(redirectKey)
  window.history.replaceState(null, '', redirectedPath)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
