import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import '@fontsource-variable/inter'
import '@fontsource-variable/outfit'
import '@fontsource-variable/space-grotesk'
import '@fontsource-variable/sora'
import '@fontsource-variable/exo-2'
import '@fontsource-variable/orbitron'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource/rajdhani/500.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import { applySavedFont, applySavedTheme } from './lib/theme'
import './styles/index.css'

applySavedTheme()
applySavedFont()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
