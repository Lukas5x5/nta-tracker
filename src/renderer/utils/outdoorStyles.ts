/**
 * Outdoor-Modus Helper
 * Zentrale Opacity-Werte und Farben für den High-Contrast Outdoor-Modus.
 * Jede Komponente importiert `getOutdoor(settings.outdoorMode)` und nutzt
 * die zurückgegebenen Werte in Inline-Styles.
 *
 * Normal: Dunkler Hintergrund, helle Schrift
 * Outdoor: Weißer Hintergrund, dunkle Schrift
 */

export interface OutdoorValues {
  /** true wenn Outdoor-Modus aktiv */
  on: boolean
  /** Text: Inaktiv / gedimmte Icons (normal: 0.45) */
  text: number
  /** Text: Sekundär (normal: 0.7) */
  textSec: number
  /** Text: Blasser Hilfstext (normal: 0.5) */
  textMuted: number
  /** Text: Sehr blasser Text (normal: 0.35) */
  textDim: number
  /** Hintergrund-Opacity (normal: 0.3) */
  bg: number
  /** Schwacher Hintergrund (normal: 0.06-0.1) */
  bgSoft: number
  /** Border-Opacity (normal: 0.08-0.1) */
  border: number
  /** Stärkere Border (normal: 0.15) */
  borderStrong: number
  /** Farbkanal für rgba(): 255 = weiß (dark mode), 0 = schwarz (outdoor) */
  c: number

  // ── Farben für Outdoor-Modus ──
  /** Panel-Hintergrund (CSS) */
  panelBg: string
  /** Panel-Hintergrund als Gradient (CSS) */
  panelGradient: string
  /** Haupttextfarbe */
  textColor: string
  /** Sekundäre Textfarbe */
  textSecColor: string
  /** Gedimmte Textfarbe */
  textMutedColor: string
  /** Sehr blasse Textfarbe */
  textDimColor: string
  /** Schatten für Panels */
  panelShadow: string
  /** Border-Farbe für Panels */
  panelBorder: string
  /** Input-Hintergrund */
  inputBg: string
  /** Weiches Element-Hintergrund (Buttons, Badges) */
  softBg: string
}

/**
 * Gibt Outdoor-Werte zurück basierend auf dem Setting.
 * @param outdoorMode - settings.outdoorMode (boolean | undefined)
 */
export function getOutdoor(outdoorMode: boolean | undefined): OutdoorValues {
  const on = !!outdoorMode
  return {
    on,
    text:         on ? 0.92 : 0.45,
    textSec:      on ? 0.92 : 0.7,
    textMuted:    on ? 0.88 : 0.5,
    textDim:      on ? 0.8  : 0.35,
    bg:           on ? 0.55 : 0.3,
    bgSoft:       on ? 0.15 : 0.06,
    border:       on ? 0.22 : 0.08,
    borderStrong: on ? 0.3  : 0.15,
    c:            on ? 0 : 255,  // rgba-Kanal: schwarz im Outdoor, weiß im Dark

    // Farben
    panelBg:        on ? '#f0f0f0' : '#0f172a',
    panelGradient:  on ? 'linear-gradient(180deg, #ffffff 0%, #f0f0f0 100%)' : 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
    textColor:      on ? '#111827' : '#ffffff',
    textSecColor:   on ? '#374151' : 'rgba(255,255,255,0.7)',
    textMutedColor: on ? '#6b7280' : 'rgba(255,255,255,0.5)',
    textDimColor:   on ? '#9ca3af' : 'rgba(255,255,255,0.35)',
    panelShadow:    on ? '0 8px 32px rgba(0,0,0,0.15)' : '0 12px 40px rgba(0,0,0,0.7)',
    panelBorder:    on ? '1px solid rgba(0,0,0,0.12)' : '1px solid rgba(255,255,255,0.1)',
    inputBg:        on ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
    softBg:         on ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)',
  }
}
