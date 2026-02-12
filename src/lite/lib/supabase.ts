import { createClient } from '@supabase/supabase-js'

// Supabase Konfiguration (gleich wie Hauptapp)
const SUPABASE_URL = 'https://imcmnhgyfkgurrdmifco.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImltY21uaGd5ZmtndXJyZG1pZmNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAxMTEyMzMsImV4cCI6MjA4NTY4NzIzM30.HUh-wIa0pNXlOvNiosg82Uo7ABxFu5sn4LLxubxw108'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
})
