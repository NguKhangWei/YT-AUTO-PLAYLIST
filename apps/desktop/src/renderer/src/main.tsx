// Window entry point.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ApiContext } from './lib/api'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root element missing')
if (!window.api) throw new Error('Preload API missing: open the app through Electron.')

createRoot(root).render(
  <StrictMode>
    <ApiContext.Provider value={window.api}>
      <App />
    </ApiContext.Provider>
  </StrictMode>,
)
