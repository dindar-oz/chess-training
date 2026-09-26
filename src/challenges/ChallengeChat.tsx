import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { maxChatLength } from '../../shared/challengeRules.ts'
import { useChallenges } from './context'

// A simple message box seen by every player in the current challenge. Messages
// are relayed live and never stored, so they're gone after a reload.
export function ChallengeChat({ userId }: { userId: string }) {
  const { current, chat, chatMutedForMe, sendMessage, setChatMutedForMe, setChatMutedForEveryone } = useChallenges()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const challenge = current?.snapshot
  const isHost = challenge?.creatorId === userId
  const mutedByHost = challenge?.chatMuted ?? false
  const canSend = !chatMutedForMe && !mutedByHost

  // Keep the newest message in view.
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [chat.length])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.trim() || sending || !canSend) return
    setSending(true)
    setError('')
    try {
      await sendMessage(draft)
      setDraft('')
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'The message was not sent.')
    } finally {
      setSending(false)
    }
  }

  async function toggleEveryone() {
    setError('')
    try {
      await setChatMutedForEveryone(!mutedByHost)
    } catch (muteError) {
      setError(muteError instanceof Error ? muteError.message : 'Could not change the chat.')
    }
  }

  if (!challenge) return null
  return <section className="challenge-chat" aria-label="Challenge chat">
    <div className="chat-heading">
      <p className="section-label">CHAT</p>
      <div className="chat-controls">
        <button className="text-button" onClick={() => setChatMutedForMe(!chatMutedForMe)}>{chatMutedForMe ? 'Unmute' : 'Mute'}</button>
        {isHost && <button className="text-button" onClick={() => void toggleEveryone()}>{mutedByHost ? 'Unmute for everyone' : 'Mute for everyone'}</button>}
      </div>
    </div>
    <div className="chat-messages" ref={listRef} aria-live="polite">
      {chatMutedForMe ? <p className="empty-log">You muted the chat. New messages are hidden.</p>
        : chat.length === 0 ? <p className="empty-log">No messages yet. Messages aren't saved and disappear when you reload.</p>
        : chat.map((message) => <div key={message.id} className={`chat-message ${message.userId === userId ? 'own' : ''}`}>
          <span className="chat-author">{message.userId === userId ? 'You' : message.username}</span>
          <span className="chat-time">{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <p>{message.text}</p>
        </div>)}
    </div>
    {mutedByHost && <p className="chat-notice">{isHost ? 'You muted the chat for everyone.' : 'The host muted the chat for everyone.'}</p>}
    <form className="chat-form" onSubmit={(event) => void submit(event)}>
      <input value={draft} maxLength={maxChatLength} disabled={!canSend} onChange={(event) => setDraft(event.target.value)} placeholder={canSend ? 'Message the other players' : 'Chat is muted'} aria-label="Chat message" />
      <button className="primary-button" disabled={sending || !canSend || !draft.trim()}>Send</button>
    </form>
    {error && <p className="auth-message">{error}</p>}
  </section>
}
