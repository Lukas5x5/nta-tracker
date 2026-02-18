import { createClient } from '@supabase/supabase-js'

// ============================================
// Supabase Konfiguration
// ============================================
// WICHTIG: Eigene Supabase URL und Anon Key hier eintragen!
// 1. Erstelle ein kostenloses Projekt auf https://supabase.com
// 2. Führe das SQL-Schema aus: docs/supabase-schema.sql
// 3. Kopiere URL und anon key von: Settings → API
const SUPABASE_URL = 'https://imcmnhgyfkgurrdmifco.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltY21uaGd5ZmtndXJyZG1pZmNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMTEyMzMsImV4cCI6MjA4NTY4NzIzM30.HUh-wIa0pNXlOvNiosg82Uo7ABxFu5sn4LLxubxw108'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  },
  global: {
    fetch: (url, options) => {
      // 5 Sekunden Timeout für alle Supabase-Anfragen
      // Verhindert langes Warten wenn offline
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timeout))
    }
  }
})

// Prüfe ob Supabase konfiguriert ist
export const isSupabaseConfigured = () => {
  return !SUPABASE_URL.includes('YOUR_PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR_ANON_KEY')
}
