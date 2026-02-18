import { useFlightStore } from '../stores/flightStore'
import { useTeamStore } from '../stores/teamStore'

let intervalId: ReturnType<typeof setInterval> | null = null

export function startPositionBroadcasting() {
  if (intervalId) return

  intervalId = setInterval(() => {
    const { gpsData, baroData } = useFlightStore.getState()
    const { session, myMemberId, sendPosition } = useTeamStore.getState()

    if (!session || !myMemberId || !gpsData) return

    sendPosition(
      gpsData.latitude,
      gpsData.longitude,
      gpsData.altitude,
      gpsData.heading || 0,
      (gpsData.speed || 0) / 3.6, // km/h -> m/s (DB und Anzeige erwarten m/s)
      baroData?.variometer || 0
    )
  }, 2000) // Alle 2 Sekunden
}

export function stopPositionBroadcasting() {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

export function isBroadcasting(): boolean {
  return intervalId !== null
}
