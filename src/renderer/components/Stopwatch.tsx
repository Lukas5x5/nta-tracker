import React, { useState, useEffect, useRef } from 'react'
import { useFlightStore } from '../stores/flightStore'
import { getOutdoor } from '../utils/outdoorStyles'

interface StopwatchProps {
  isOpen: boolean
  onClose: () => void
}

type TabType = 'stopwatch' | 'timer' | 'alarm'

export function Stopwatch({ isOpen, onClose }: StopwatchProps) {
  const settings = useFlightStore(s => s.settings)
  const o = getOutdoor(settings.outdoorMode)

  // Tab-System
  const [activeTab, setActiveTab] = useState<TabType>('stopwatch')

  // === Stoppuhr State ===
  const [time, setTime] = useState(0) // Zeit in Millisekunden
  const [isRunning, setIsRunning] = useState(false)
  const [laps, setLaps] = useState<number[]>([])
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  // === Timer State (Countdown) ===
  const [timerTime, setTimerTime] = useState(0) // Restzeit in ms
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerInputMin, setTimerInputMin] = useState('')
  const [timerInputSec, setTimerInputSec] = useState('')
  const [timerAlarmActive, setTimerAlarmActive] = useState(false)
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // === Wecker State ===
  const [alarmTargetTime, setAlarmTargetTime] = useState('') // HH:MM
  const [alarmActive, setAlarmActive] = useState(false)
  const [alarmTriggered, setAlarmTriggered] = useState(false)
  const [currentTime, setCurrentTime] = useState('')
  const alarmCheckRef = useRef<NodeJS.Timeout | null>(null)

  // Audio
  const audioContextRef = useRef<AudioContext | null>(null)

  // Position State für Drag
  const [position, setPosition] = useState({ x: 20, y: 80 })
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null)

  // === Stoppuhr-Logik ===
  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setTime(prev => prev + 10)
      }, 10)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isRunning])

  // === Timer-Logik (Countdown) ===
  useEffect(() => {
    if (timerRunning && timerTime > 0) {
      timerIntervalRef.current = setInterval(() => {
        setTimerTime(prev => {
          if (prev <= 10) {
            setTimerRunning(false)
            setTimerAlarmActive(true)
            playAlarmSound()
            return 0
          }
          return prev - 10
        })
      }, 10)
    } else {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current)
        timerIntervalRef.current = null
      }
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current)
    }
  }, [timerRunning])

  // === Wecker-Logik ===
  useEffect(() => {
    if (alarmActive && alarmTargetTime) {
      alarmCheckRef.current = setInterval(() => {
        const now = new Date()
        const nowStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
        setCurrentTime(nowStr)
        if (nowStr === alarmTargetTime && !alarmTriggered) {
          setAlarmTriggered(true)
          setAlarmActive(false)
          playAlarmSound()
        }
      }, 1000)
    } else {
      if (alarmCheckRef.current) {
        clearInterval(alarmCheckRef.current)
        alarmCheckRef.current = null
      }
    }
    return () => {
      if (alarmCheckRef.current) clearInterval(alarmCheckRef.current)
    }
  }, [alarmActive, alarmTargetTime, alarmTriggered])

  // Aktuelle Uhrzeit für Wecker-Tab live aktualisieren
  useEffect(() => {
    if (activeTab === 'alarm' && !alarmActive) {
      const interval = setInterval(() => {
        const now = new Date()
        setCurrentTime(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`)
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [activeTab, alarmActive])

  // === Alarm-Sound ===
  const playAlarmSound = () => {
    if (settings.timerAlarmSound === false) return
    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioContext()
      }
      const ctx = audioContextRef.current
      const volume = settings.timerAlarmVolume ?? 0.7
      const now = ctx.currentTime
      // 5 absteigende Beeps als Alarm
      for (let i = 0; i < 5; i++) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.frequency.value = 880 - i * 100
        osc.type = 'sine'
        gain.gain.setValueAtTime(volume, now + i * 0.3)
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.3 + 0.25)
        osc.start(now + i * 0.3)
        osc.stop(now + i * 0.3 + 0.25)
      }
    } catch (e) {
      console.warn('Alarm sound fehlgeschlagen:', e)
    }
  }

  // Drag handlers
  useEffect(() => {
    const handleMove = (clientX: number, clientY: number) => {
      if (!dragRef.current) return
      const dx = clientX - dragRef.current.startX
      const dy = clientY - dragRef.current.startY
      setPosition({
        x: Math.max(0, dragRef.current.startPosX + dx),
        y: Math.max(0, dragRef.current.startPosY + dy)
      })
    }

    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY)
    const handleTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (touch) handleMove(touch.clientX, touch.clientY)
    }
    const handleEnd = () => {
      setIsDragging(false)
      dragRef.current = null
    }

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleEnd)
      window.addEventListener('touchmove', handleTouchMove, { passive: true })
      window.addEventListener('touchend', handleEnd)
      window.addEventListener('touchcancel', handleEnd)
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleEnd)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleEnd)
      window.removeEventListener('touchcancel', handleEnd)
    }
  }, [isDragging])

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input')) return
    e.preventDefault()
    setIsDragging(true)
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: position.x, startPosY: position.y }
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('input')) return
    const touch = e.touches[0]
    if (!touch) return
    e.stopPropagation()
    setIsDragging(true)
    dragRef.current = { startX: touch.clientX, startY: touch.clientY, startPosX: position.x, startPosY: position.y }
  }

  const formatTime = (ms: number) => {
    const minutes = Math.floor(ms / 60000)
    const seconds = Math.floor((ms % 60000) / 1000)
    const centiseconds = Math.floor((ms % 1000) / 10)
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`
  }

  const formatTimerDisplay = (ms: number) => {
    const totalSec = Math.ceil(ms / 1000)
    const min = Math.floor(totalSec / 60)
    const sec = totalSec % 60
    return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
  }

  if (!isOpen) return null

  const btnStyle = (active: boolean, color: string): React.CSSProperties => ({
    flex: 1, padding: '10px', border: 'none', borderRadius: '8px', cursor: 'pointer',
    fontWeight: 700, fontSize: '12px', color: 'white',
    background: active ? `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)` : `rgba(255,255,255,${o.on ? 0.2 : 0.1})`
  })

  return (
    <div
      className="stopwatch-panel"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: '220px',
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
        borderRadius: '12px',
        boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
        border: `1px solid rgba(255,255,255,${o.borderStrong})`,
        zIndex: 10000,
        overflow: 'hidden',
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none'
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Header mit Tabs */}
      <div style={{
        padding: '8px 10px',
        borderBottom: `1px solid rgba(255,255,255,${o.border})`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', gap: '2px' }}>
          {(['stopwatch', 'timer', 'alarm'] as TabType[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '4px 8px', fontSize: '10px',
                fontWeight: activeTab === tab ? 700 : 500,
                background: activeTab === tab ? '#3b82f6' : 'transparent',
                color: activeTab === tab ? 'white' : `rgba(255,255,255,${o.textMuted})`,
                border: 'none', borderRadius: '6px', cursor: 'pointer'
              }}
            >
              {tab === 'stopwatch' ? '⏱ Stopp' : tab === 'timer' ? '⏳ Timer' : '⏰ Wecker'}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          style={{
            background: `rgba(255,255,255,${o.on ? 0.2 : 0.1})`,
            border: 'none', color: 'white', cursor: 'pointer',
            width: '22px', height: '22px', borderRadius: '6px',
            fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          ✕
        </button>
      </div>

      {/* === Tab: Stoppuhr === */}
      {activeTab === 'stopwatch' && (
        <>
          <div style={{ padding: '20px 12px', textAlign: 'center' }}>
            <div style={{
              fontSize: '32px', fontWeight: 700, fontFamily: 'monospace',
              color: isRunning ? '#22c55e' : 'white', letterSpacing: '2px',
              textShadow: isRunning ? '0 0 10px rgba(34, 197, 94, 0.5)' : 'none'
            }}>
              {formatTime(time)}
            </div>
          </div>
          <div style={{ padding: '0 12px 12px', display: 'flex', gap: '8px' }}>
            <button onClick={() => setIsRunning(!isRunning)} style={btnStyle(true, isRunning ? '#ef4444' : '#22c55e')}>
              {isRunning ? 'Stop' : 'Start'}
            </button>
            <button
              onClick={() => { if (isRunning) setLaps(prev => [time, ...prev]) }}
              disabled={!isRunning}
              style={{ ...btnStyle(isRunning, '#3b82f6'), opacity: isRunning ? 1 : 0.5, cursor: isRunning ? 'pointer' : 'default' }}
            >
              Runde
            </button>
            <button onClick={() => { setIsRunning(false); setTime(0); setLaps([]) }} style={btnStyle(false, '')}>↺</button>
          </div>
          {laps.length > 0 && (
            <div style={{ maxHeight: '120px', overflow: 'auto', borderTop: `1px solid rgba(255,255,255,${o.border})`, padding: '8px 12px' }}>
              {laps.map((lap, index) => (
                <div key={index} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '11px', color: `rgba(255,255,255,${o.textSec})`, borderBottom: index < laps.length - 1 ? `1px solid rgba(255,255,255,${o.bgSoft})` : 'none' }}>
                  <span>Runde {laps.length - index}</span>
                  <span style={{ fontFamily: 'monospace', color: '#3b82f6' }}>{formatTime(lap)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* === Tab: Timer (Countdown) === */}
      {activeTab === 'timer' && (
        <>
          <div style={{ padding: '16px 12px', textAlign: 'center' }}>
            {/* Alarm-Anzeige */}
            {timerAlarmActive ? (
              <div style={{ marginBottom: '12px' }}>
                <div style={{
                  fontSize: '28px', fontWeight: 700, color: '#ef4444',
                  animation: 'none', textShadow: '0 0 20px rgba(239, 68, 68, 0.6)'
                }}>
                  ALARM!
                </div>
                <div style={{ fontSize: '11px', color: `rgba(255,255,255,${o.textMuted})`, marginTop: '4px' }}>Timer abgelaufen</div>
                <button
                  onClick={() => setTimerAlarmActive(false)}
                  style={{ marginTop: '8px', padding: '8px 20px', background: '#ef4444', border: 'none', borderRadius: '8px', color: 'white', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                >
                  OK
                </button>
              </div>
            ) : timerRunning || timerTime > 0 ? (
              /* Countdown läuft oder pausiert */
              <div>
                <div style={{
                  fontSize: '36px', fontWeight: 700, fontFamily: 'monospace',
                  color: timerRunning ? '#f59e0b' : 'white', letterSpacing: '2px',
                  textShadow: timerRunning ? '0 0 10px rgba(245, 158, 11, 0.5)' : 'none'
                }}>
                  {formatTimerDisplay(timerTime)}
                </div>
              </div>
            ) : (
              /* Timer-Eingabe */
              <div>
                <div style={{ fontSize: '10px', color: `rgba(255,255,255,${o.textMuted})`, marginBottom: '8px' }}>ZEIT EINSTELLEN</div>
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center' }}>
                  <input
                    type="number" min="0" max="99" placeholder="Min"
                    value={timerInputMin}
                    onChange={(e) => setTimerInputMin(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    style={{
                      width: '50px', padding: '8px', textAlign: 'center',
                      background: 'rgba(0,0,0,0.3)', border: `1px solid rgba(255,255,255,${o.border})`,
                      borderRadius: '8px', color: 'white', fontSize: '18px', fontFamily: 'monospace',
                      fontWeight: 700, outline: 'none'
                    }}
                  />
                  <span style={{ fontSize: '20px', color: `rgba(255,255,255,${o.textMuted})`, fontWeight: 700 }}>:</span>
                  <input
                    type="number" min="0" max="59" placeholder="Sek"
                    value={timerInputSec}
                    onChange={(e) => setTimerInputSec(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    style={{
                      width: '50px', padding: '8px', textAlign: 'center',
                      background: 'rgba(0,0,0,0.3)', border: `1px solid rgba(255,255,255,${o.border})`,
                      borderRadius: '8px', color: 'white', fontSize: '18px', fontFamily: 'monospace',
                      fontWeight: 700, outline: 'none'
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Timer Controls */}
          {!timerAlarmActive && (
            <div style={{ padding: '0 12px 12px', display: 'flex', gap: '8px' }}>
              {timerRunning ? (
                <>
                  <button onClick={() => setTimerRunning(false)} style={btnStyle(true, '#ef4444')}>Pause</button>
                  <button onClick={() => { setTimerRunning(false); setTimerTime(0) }} style={btnStyle(false, '')}>↺</button>
                </>
              ) : timerTime > 0 ? (
                <>
                  <button onClick={() => setTimerRunning(true)} style={btnStyle(true, '#22c55e')}>Weiter</button>
                  <button onClick={() => setTimerTime(0)} style={btnStyle(false, '')}>↺</button>
                </>
              ) : (
                <button
                  onClick={() => {
                    const min = parseInt(timerInputMin) || 0
                    const sec = parseInt(timerInputSec) || 0
                    const totalMs = (min * 60 + sec) * 1000
                    if (totalMs > 0) {
                      setTimerTime(totalMs)
                      setTimerRunning(true)
                    }
                  }}
                  disabled={!timerInputMin && !timerInputSec}
                  style={{
                    ...btnStyle(true, '#f59e0b'),
                    opacity: (!timerInputMin && !timerInputSec) ? 0.5 : 1,
                    cursor: (!timerInputMin && !timerInputSec) ? 'default' : 'pointer'
                  }}
                >
                  Start
                </button>
              )}
            </div>
          )}

          {/* Schnell-Buttons für häufige Zeiten */}
          {!timerRunning && timerTime === 0 && !timerAlarmActive && (
            <div style={{ padding: '0 12px 12px', display: 'flex', gap: '4px' }}>
              {[1, 3, 5, 10, 15].map(min => (
                <button
                  key={min}
                  onClick={() => { setTimerTime(min * 60000); setTimerRunning(true) }}
                  style={{
                    flex: 1, padding: '6px', fontSize: '9px', fontWeight: 600,
                    background: `rgba(255,255,255,${o.on ? 0.12 : 0.06})`,
                    border: `1px solid rgba(255,255,255,${o.border})`,
                    borderRadius: '6px', color: `rgba(255,255,255,${o.textSec})`, cursor: 'pointer'
                  }}
                >
                  {min}m
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* === Tab: Wecker === */}
      {activeTab === 'alarm' && (
        <>
          <div style={{ padding: '16px 12px', textAlign: 'center' }}>
            {/* Alarm ausgelöst */}
            {alarmTriggered ? (
              <div>
                <div style={{
                  fontSize: '28px', fontWeight: 700, color: '#ef4444',
                  textShadow: '0 0 20px rgba(239, 68, 68, 0.6)'
                }}>
                  WECKER!
                </div>
                <div style={{ fontSize: '13px', color: `rgba(255,255,255,${o.textSec})`, marginTop: '4px' }}>{alarmTargetTime}</div>
                <button
                  onClick={() => { setAlarmTriggered(false); setAlarmTargetTime('') }}
                  style={{ marginTop: '8px', padding: '8px 20px', background: '#ef4444', border: 'none', borderRadius: '8px', color: 'white', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                >
                  OK
                </button>
              </div>
            ) : (
              <div>
                {/* Aktuelle Uhrzeit */}
                <div style={{ fontSize: '10px', color: `rgba(255,255,255,${o.textMuted})`, marginBottom: '4px' }}>AKTUELLE ZEIT</div>
                <div style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'monospace', color: `rgba(255,255,255,${o.textSec})`, marginBottom: '16px' }}>
                  {currentTime || '--:--'}
                </div>

                {/* Wecker-Zeit einstellen */}
                <div style={{ fontSize: '10px', color: `rgba(255,255,255,${o.textMuted})`, marginBottom: '8px' }}>WECKZEIT</div>
                <input
                  type="time"
                  value={alarmTargetTime}
                  onChange={(e) => { setAlarmTargetTime(e.target.value); setAlarmTriggered(false) }}
                  disabled={alarmActive}
                  style={{
                    padding: '8px 12px', textAlign: 'center', width: '120px',
                    background: 'rgba(0,0,0,0.3)', border: `1px solid rgba(255,255,255,${o.border})`,
                    borderRadius: '8px', color: alarmActive ? '#f59e0b' : 'white',
                    fontSize: '20px', fontFamily: 'monospace', fontWeight: 700, outline: 'none'
                  }}
                />

                {/* Status */}
                {alarmActive && (
                  <div style={{ marginTop: '8px', fontSize: '11px', color: '#f59e0b', fontWeight: 600 }}>
                    Wecker aktiv – wartet auf {alarmTargetTime}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Wecker Controls */}
          {!alarmTriggered && (
            <div style={{ padding: '0 12px 12px', display: 'flex', gap: '8px' }}>
              {alarmActive ? (
                <button onClick={() => setAlarmActive(false)} style={btnStyle(true, '#ef4444')}>Deaktivieren</button>
              ) : (
                <button
                  onClick={() => { if (alarmTargetTime) { setAlarmActive(true); setAlarmTriggered(false) } }}
                  disabled={!alarmTargetTime}
                  style={{
                    ...btnStyle(true, '#f59e0b'),
                    opacity: !alarmTargetTime ? 0.5 : 1,
                    cursor: !alarmTargetTime ? 'default' : 'pointer'
                  }}
                >
                  Aktivieren
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
