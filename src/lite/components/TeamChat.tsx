import React, { useState, useRef, useEffect } from 'react'
import { useTrackerStore } from '../stores/trackerStore'

const QUICK_MESSAGES = [
  'Guter Startplatz gefunden',
  'Bin gelandet',
  'Brauche Hilfe',
  'Warte auf euch'
]

interface TeamChatProps {
  onClose: () => void
}

export function TeamChat({ onClose }: TeamChatProps) {
  const { pilots, myMemberId, messages, sendMessage } = useTrackerStore()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [chatTarget, setChatTarget] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, chatTarget])

  const handleSend = async (msg?: string) => {
    const messageText = msg || text.trim()
    if (!messageText || !myMemberId) return

    setSending(true)
    await sendMessage(messageText, chatTarget)
    setSending(false)
    setText('')
  }

  const targetPilot = chatTarget ? pilots.find(p => p.memberId === chatTarget) : null

  // Nachrichten filtern nach aktuellem Chat-Kanal
  const filteredMessages = messages.filter(msg => {
    if (chatTarget === null) {
      // "Alle"-Kanal: nur Broadcast-Nachrichten (ohne target)
      return !msg.targetMemberId
    } else {
      // Privat-Chat: Nachrichten zwischen mir und dem ausgewählten Piloten
      const isFromMeToTarget = msg.isMine && msg.targetMemberId === chatTarget
      const isFromTargetToMe = msg.memberId === chatTarget && (!msg.targetMemberId || msg.targetMemberId === myMemberId)
      return isFromMeToTarget || isFromTargetToMe
    }
  })

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(15, 23, 42, 0.98)',
      zIndex: 10000,
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        flexShrink: 0
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#fff' }}>Team Chat</div>
        <button
          onClick={onClose}
          style={{
            width: 32,
            height: 32,
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            color: 'rgba(255,255,255,0.7)',
            fontSize: 16,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          &times;
        </button>
      </div>

      {/* Target Selector */}
      <div style={{
        display: 'flex',
        gap: 6,
        padding: '8px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        flexShrink: 0,
        overflowX: 'auto'
      }}>
        <button
          onClick={() => setChatTarget(null)}
          style={{
            padding: '4px 10px',
            borderRadius: 12,
            border: 'none',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            flexShrink: 0,
            background: chatTarget === null ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255,255,255,0.05)',
            color: chatTarget === null ? '#3b82f6' : 'rgba(255,255,255,0.5)'
          }}
        >
          Alle
        </button>
        {pilots.filter(p => p.memberId !== myMemberId).map(p => (
          <button
            key={p.memberId}
            onClick={() => setChatTarget(p.memberId)}
            style={{
              padding: '4px 10px',
              borderRadius: 12,
              border: 'none',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              flexShrink: 0,
              background: chatTarget === p.memberId ? `${p.color}33` : 'rgba(255,255,255,0.05)',
              color: chatTarget === p.memberId ? p.color : 'rgba(255,255,255,0.5)'
            }}
          >
            {p.callsign}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
        {!myMemberId ? (
          <div style={{
            padding: 20,
            textAlign: 'center',
            color: 'rgba(255,255,255,0.4)',
            fontSize: 12
          }}>
            Du bist nicht als Team-Mitglied registriert und kannst keine Nachrichten senden.
          </div>
        ) : filteredMessages.length === 0 ? (
          <div style={{
            padding: 20,
            textAlign: 'center',
            color: 'rgba(255,255,255,0.3)',
            fontSize: 12
          }}>
            Noch keine Nachrichten
          </div>
        ) : (
          filteredMessages.map(msg => (
            <div
              key={msg.id}
              style={{
                marginBottom: 6,
                padding: '6px 8px',
                borderRadius: 8,
                background: msg.isMine ? 'rgba(59, 130, 246, 0.1)' : 'rgba(255,255,255,0.03)',
                borderLeft: `3px solid ${msg.color}`
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: msg.color }}>
                  {msg.isMine ? 'Ich' : msg.callsign}
                </span>
                {msg.targetMemberId && (
                  <span style={{
                    fontSize: 9,
                    color: '#a855f7',
                    background: 'rgba(168, 85, 247, 0.15)',
                    padding: '1px 5px',
                    borderRadius: 4
                  }}>
                    an {msg.targetCallsign || 'Privat'}
                  </span>
                )}
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>
                  {msg.createdAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)' }}>
                {msg.message}
              </div>
            </div>
          ))
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Quick Messages */}
      {myMemberId && (
        <div style={{
          display: 'flex',
          gap: 4,
          padding: '6px 12px',
          borderTop: '1px solid rgba(255,255,255,0.05)',
          flexShrink: 0,
          overflowX: 'auto'
        }}>
          {QUICK_MESSAGES.map(qm => (
            <button
              key={qm}
              onClick={() => handleSend(qm)}
              disabled={sending}
              style={{
                padding: '4px 8px',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.03)',
                color: 'rgba(255,255,255,0.5)',
                fontSize: 10,
                cursor: 'pointer',
                flexShrink: 0,
                whiteSpace: 'nowrap'
              }}
            >
              {qm}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      {myMemberId && (
        <div style={{
          display: 'flex',
          gap: 8,
          padding: '8px 12px',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          flexShrink: 0
        }}>
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSend() }}
            placeholder={targetPilot ? `An ${targetPilot.callsign}...` : 'Nachricht an alle...'}
            disabled={sending}
            style={{
              flex: 1,
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8,
              color: '#fff',
              fontSize: 13,
              outline: 'none'
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={sending || !text.trim()}
            style={{
              padding: '10px 16px',
              background: text.trim() ? 'linear-gradient(135deg, #3b82f6, #8b5cf6)' : 'rgba(255,255,255,0.05)',
              border: 'none',
              borderRadius: 8,
              color: text.trim() ? '#fff' : 'rgba(255,255,255,0.3)',
              fontSize: 13,
              fontWeight: 600,
              cursor: text.trim() && !sending ? 'pointer' : 'not-allowed'
            }}
          >
            {sending ? '...' : 'Senden'}
          </button>
        </div>
      )}
    </div>
  )
}
