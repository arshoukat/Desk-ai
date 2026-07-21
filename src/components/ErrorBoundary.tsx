import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches render failures so a bad message / markdown parse cannot blank the app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Do not log user documents, license keys, or message content.
    console.error(
      '[ErrorBoundary]',
      error.name,
      error.message?.slice(0, 200),
      info.componentStack?.slice(0, 400),
    )
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink px-6 text-center">
          <p className="font-display text-2xl font-bold text-fg-strong">
            Something went wrong
          </p>
          <p className="max-w-md text-sm text-slate-muted">
            An unexpected UI error occurred. Reload the app to continue. Your
            local chats and documents stay on this device.
          </p>
          <button
            type="button"
            className="rounded-xl bg-teal px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-teal-dim"
            onClick={() => {
              this.setState({ error: null })
              window.location.reload()
            }}
          >
            Reload Desk Ai
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
