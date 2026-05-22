import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App'
import { AppErrorBoundary } from './shared/ui/AppErrorBoundary'
import { installGlobalErrorHandlers } from './shared/diagnostics/errorReporter'

// Install window 'error' + 'unhandledrejection' listeners BEFORE the
// React tree mounts so a sync throw during initial render also lands
// in Mixpanel. The AppErrorBoundary catches React render errors; the
// global handlers catch everything outside React (async tasks,
// event handlers that aren't React events, third-party scripts).
installGlobalErrorHandlers()

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
)
