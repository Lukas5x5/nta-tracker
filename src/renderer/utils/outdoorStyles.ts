/**
 * Outdoor-Modus Helper
 * Zentrale Opacity-Werte für den High-Contrast Outdoor-Modus.
 * Jede Komponente importiert `getOutdoor(settings.outdoorMode)` und nutzt
 * die zurückgegebenen Werte in Inline-Styles.
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
}

/**
 * Gibt Outdoor-Opacity-Werte zurück basierend auf dem Setting.
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
  }
}
