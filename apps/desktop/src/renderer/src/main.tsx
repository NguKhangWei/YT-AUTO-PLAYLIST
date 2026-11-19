// Window entry point.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ApiContext } from './lib/api'
import { createHttpApi } from './lib/http-api'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root element missing')
// In Electron the preload sets window.api; in a browser, talk to the auto-yt server.
const api = window.api ?? createHttpApi()

createRoot(root).render(
  <StrictMode>
    <ApiContext.Provider value={api}>
      <App />
    </ApiContext.Provider>
  </StrictMode>,
)
