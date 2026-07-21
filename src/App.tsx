import { ErrorBoundary } from './components/ErrorBoundary'
import { LicenseGate } from './components/LicenseGate'

export default function App() {
  return (
    <ErrorBoundary>
      <main className="h-full min-h-screen">
        <LicenseGate />
      </main>
    </ErrorBoundary>
  )
}
