import { readStored, writeStored } from './storage'

// Game sounds, synthesized with the Web Audio API: no audio files to load.
// Pieces are wooden "knocks" (band-passed noise over a low thump); events are
// short tone sequences.

export type SoundName =
  | 'move' | 'capture' | 'castle' | 'promote' | 'check' | 'reply'
  | 'deviation' | 'lowTime' | 'timeout'
  | 'sessionStart' | 'sessionEnd'
  | 'countdown' | 'challengeStart' | 'challengeEnd'
  | 'invitation' | 'playerJoined' | 'chat' | 'notify'

const storageKey = 'chess-training-sound'
const masterVolume = 0.6

let enabled = readStored<boolean>(storageKey, true) !== false
let context: AudioContext | null = null
let master: GainNode | null = null
const listeners = new Set<(on: boolean) => void>()

export function isSoundEnabled() {
  return enabled
}

export function setSoundEnabled(on: boolean) {
  enabled = on
  writeStored(storageKey, on)
  listeners.forEach((listener) => listener(on))
  if (on) play('move')
}

export function onSoundSettingChange(listener: (on: boolean) => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function audio() {
  if (!context) {
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return null
    context = new AudioContextClass()
    master = context.createGain()
    master.gain.value = masterVolume
    master.connect(context.destination)
  }
  if (context.state === 'suspended') void context.resume()
  return context
}

// Browsers only allow audio after a user gesture; unlock on the first one so a
// later invitation can sound even if it arrives before any click on the board.
if (typeof window !== 'undefined') {
  const unlock = () => {
    audio()
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock)
  window.addEventListener('keydown', unlock)
}

function tone(ctx: AudioContext, at: number, frequency: number, duration: number, options: { type?: OscillatorType; gain?: number; endFrequency?: number } = {}) {
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.type = options.type ?? 'sine'
  oscillator.frequency.setValueAtTime(frequency, at)
  if (options.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, at + duration)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(options.gain ?? 0.2, at + 0.008)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration)
  oscillator.connect(gain).connect(master!)
  oscillator.start(at)
  oscillator.stop(at + duration + 0.02)
}

function knock(ctx: AudioContext, at: number, options: { pitch?: number; gain?: number } = {}) {
  const pitch = options.pitch ?? 1
  const gainValue = options.gain ?? 0.5
  const length = Math.floor(ctx.sampleRate * 0.05)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** 3
  const noise = ctx.createBufferSource()
  noise.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 1700 * pitch
  filter.Q.value = 1.4
  const gain = ctx.createGain()
  gain.gain.value = gainValue
  noise.connect(filter).connect(gain).connect(master!)
  noise.start(at)
  tone(ctx, at, 190 * pitch, 0.07, { type: 'triangle', gain: gainValue * 0.35, endFrequency: 120 * pitch })
}

function notes(ctx: AudioContext, at: number, frequencies: number[], step: number, duration: number, options: { type?: OscillatorType; gain?: number } = {}) {
  frequencies.forEach((frequency, index) => tone(ctx, at + index * step, frequency, duration, options))
}

const sounds: Record<SoundName, (ctx: AudioContext, at: number) => void> = {
  move: (ctx, at) => knock(ctx, at),
  // The historical opponent's reply: a softer, slightly lower knock.
  reply: (ctx, at) => knock(ctx, at, { pitch: 0.85, gain: 0.32 }),
  capture: (ctx, at) => { knock(ctx, at, { pitch: 0.8, gain: 0.65 }); knock(ctx, at + 0.05, { pitch: 1.1, gain: 0.4 }) },
  castle: (ctx, at) => { knock(ctx, at); knock(ctx, at + 0.1, { pitch: 1.05 }) },
  promote: (ctx, at) => { knock(ctx, at); notes(ctx, at + 0.05, [659, 784, 1047], 0.07, 0.14, { gain: 0.12 }) },
  check: (ctx, at) => { knock(ctx, at); notes(ctx, at + 0.04, [880, 1175], 0.09, 0.12, { type: 'triangle', gain: 0.14 }) },
  deviation: (ctx, at) => tone(ctx, at, 240, 0.22, { gain: 0.16, endFrequency: 170 }),
  lowTime: (ctx, at) => notes(ctx, at, [1320, 1320], 0.14, 0.07, { type: 'square', gain: 0.05 }),
  timeout: (ctx, at) => notes(ctx, at, [440, 349, 262], 0.16, 0.22, { type: 'triangle', gain: 0.16 }),
  sessionStart: (ctx, at) => notes(ctx, at, [523, 784], 0.11, 0.18, { gain: 0.14 }),
  sessionEnd: (ctx, at) => notes(ctx, at, [523, 659, 784, 1047], 0.09, 0.26, { gain: 0.13 }),
  countdown: (ctx, at) => tone(ctx, at, 880, 0.08, { type: 'triangle', gain: 0.12 }),
  challengeStart: (ctx, at) => { notes(ctx, at, [523, 659, 784], 0, 0.45, { type: 'triangle', gain: 0.1 }); tone(ctx, at, 1047, 0.5, { gain: 0.08 }) },
  challengeEnd: (ctx, at) => { notes(ctx, at, [392, 523, 659], 0.1, 0.2, { gain: 0.12 }); notes(ctx, at + 0.32, [523, 659, 784, 1047], 0, 0.7, { type: 'triangle', gain: 0.07 }) },
  invitation: (ctx, at) => { tone(ctx, at, 988, 0.6, { gain: 0.16 }); tone(ctx, at + 0.18, 784, 0.8, { gain: 0.14 }); tone(ctx, at, 1976, 0.3, { gain: 0.03 }) },
  playerJoined: (ctx, at) => notes(ctx, at, [660, 880], 0.08, 0.14, { gain: 0.12 }),
  chat: (ctx, at) => tone(ctx, at, 1250, 0.07, { gain: 0.08, endFrequency: 850 }),
  notify: (ctx, at) => notes(ctx, at, [784, 988], 0.12, 0.3, { gain: 0.12 }),
}

export function play(name: SoundName, delaySeconds = 0) {
  // Lets browser tests observe which sounds would play.
  ;(globalThis as { __soundLog?: string[] }).__soundLog?.push(name)
  if (!enabled) return
  const ctx = audio()
  if (!ctx || !master) return
  try {
    sounds[name](ctx, ctx.currentTime + 0.01 + delaySeconds)
  } catch {
    // Sound is decoration; never let it break the game.
  }
}

// Picks the piece sound for a move from its SAN (e.g. "Nxe5+", "O-O", "e8=Q").
export function moveSound(san: string, fromOpponent = false): SoundName {
  if (san.includes('+') || san.includes('#')) return 'check'
  if (san.includes('x')) return 'capture'
  if (san.startsWith('O-O')) return 'castle'
  if (san.includes('=')) return 'promote'
  return fromOpponent ? 'reply' : 'move'
}
