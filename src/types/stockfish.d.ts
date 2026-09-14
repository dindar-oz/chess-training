declare module 'stockfish' {
  type StockfishEngine = {
    listener?: (line: string) => void
    sendCommand: (command: string) => void
  }

  export default function initStockfish(enginePath?: string): Promise<StockfishEngine>
}
