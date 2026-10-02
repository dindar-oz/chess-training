import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type ErrorBoundaryProps = {
  children: ReactNode
  // What the reader can do instead, e.g. go back to the page they came from.
  actionLabel: string
  onAction: () => void
}

// Keeps an error while drawing one part of the app from blanking the whole
// page: the part is replaced by the error and a way out, and the rest keeps working.
export class ErrorBoundary extends Component<ErrorBoundaryProps, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return <main className="app-shell error-panel" role="alert">
      <p className="section-label">SOMETHING WENT WRONG</p>
      <h2>This page ran into a problem.</h2>
      <p>The rest of Replay Lab is fine. If it keeps happening, this detail helps fix it:</p>
      <code>{this.state.error.message}</code>
      <button className="primary-button" onClick={this.props.onAction}>{this.props.actionLabel}</button>
    </main>
  }
}
