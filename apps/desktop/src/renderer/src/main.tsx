import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ApiContext, createApi } from './lib/api'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root element missing')
if (!window.bridge) throw new Error('Preload bridge missing: open the app through Electron.')

createRoot(root).render(
  <StrictMode>
    <ApiContext.Provider value={createApi(window.bridge)}>
      <App />
    </ApiContext.Provider>
  </StrictMode>,
)
