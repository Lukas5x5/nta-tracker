import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'
import { installMockAPI } from './utils/mockBluetooth'

// Installiere Mock API für Browser-Entwicklung
// Wird nur installiert wenn window.ntaAPI nicht existiert (nicht in Electron)
installMockAPI()

// Debug-Info
if (window.ntaAPI) {
  console.log('✅ NTA API verfügbar:', {
    bluetooth: !!window.ntaAPI.bluetooth,
    gps: !!window.ntaAPI.gps,
    baro: !!window.ntaAPI.baro,
    files: !!window.ntaAPI.files,
    maps: !!window.ntaAPI.maps
  })
} else {
  console.warn('⚠️ NTA API nicht verfügbar - Mock wird verwendet')
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)
