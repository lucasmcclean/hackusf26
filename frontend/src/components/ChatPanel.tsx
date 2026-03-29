import { useState, type KeyboardEvent } from 'react'
import { Send } from 'lucide-react'

export interface ChatMessage {
  id: string
  from: string
  to: string
  content: string
  timestamp: Date
  fromType: 'User' | 'Responder' | 'System'
}

interface ChatPanelProps {
  messages: ChatMessage[]
  currentUserId: string
  currentUserType: 'User' | 'Responder'
  onSendMessage: (content: string, to?: string) => void
  showBroadcast?: boolean
}

export function ChatPanel({
  messages,
  currentUserId,
  currentUserType,
  onSendMessage,
  showBroadcast = false,
}: ChatPanelProps) {
  const [newMessage, setNewMessage] = useState('')

  const handleSend = () => {
    if (newMessage.trim()) {
      onSendMessage(newMessage.trim(), showBroadcast ? 'broadcast' : undefined)
      setNewMessage('')
    }
  }

  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const relevantMessages = messages.filter((msg) => (
    msg.from === currentUserId
    || msg.to === currentUserId
    || msg.to === 'broadcast'
    || msg.fromType === 'System'
  )).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

  const chatTitle = showBroadcast
    ? 'Community Broadcasts'
    : `${currentUserType === 'User' ? 'Survivor' : currentUserType} Messages`

  return (
    <div className="flex h-full min-h-0 flex-col panel-glass rounded-2xl overflow-hidden">
      <div className="border-b border-[var(--border-soft)] bg-[rgba(9,18,32,0.78)] px-4 py-3">
        <div className="soft-label">Communications</div>
        <h3 className="mt-1 font-semibold text-[var(--text-strong)]">{chatTitle}</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-[rgba(8,15,26,0.66)]">
        {relevantMessages.length === 0 ? (
          <p className="text-[var(--text-muted)] text-center mt-8">No messages yet. You are all set.</p>
        ) : (
          relevantMessages.map(msg => {
            const isFromMe = msg.from === currentUserId
            const isBroadcast = msg.to === 'broadcast'

            return (
              <div
                key={msg.id}
                className={`flex ${isFromMe ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[74%] rounded-2xl px-4 py-2.5 border ${
                    isBroadcast
                      ? 'bg-[rgba(255,190,77,0.14)] border-[rgba(255,190,77,0.44)] text-[#ffe6be]'
                      : isFromMe
                        ? 'bg-[rgba(53,184,255,0.2)] border-[rgba(86,194,255,0.58)] text-[#e8f6ff]'
                        : 'bg-[rgba(154,178,209,0.12)] border-[rgba(141,169,203,0.38)] text-[var(--text-primary)]'
                  }`}
                >
                  {!isFromMe && (
                    <div className="text-xs font-semibold mb-1 opacity-85">
                      {msg.fromType === 'Responder' ? 'Responder ' : msg.fromType === 'User' ? 'Survivor ' : 'Notice '}
                      {msg.from}
                    </div>
                  )}
                  <div className="text-sm">{msg.content}</div>
                  <div className={`text-xs mt-1 ${isFromMe ? 'text-[#bfe7ff]' : 'text-[var(--text-muted)]'}`}>
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="border-t border-[var(--border-soft)] bg-[rgba(9,18,32,0.82)] p-4">
        {showBroadcast && (
          <div className="mb-2 rounded-md border border-[rgba(255,190,77,0.44)] bg-[rgba(255,190,77,0.12)] px-2 py-1 text-xs text-[#ffe0af]">
            This message will be shared with all Survivors
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={showBroadcast ? 'Type a community update...' : 'Type your message...'}
            className="flex-1 rounded-lg border border-[var(--border-soft)] bg-[rgba(8,16,29,0.88)] px-3 py-2 text-[var(--text-strong)] focus:outline-none focus:ring-2 focus:ring-[var(--brand)]"
          />
          <button
            onClick={handleSend}
            disabled={!newMessage.trim()}
            className="btn-primary flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={18} />
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
