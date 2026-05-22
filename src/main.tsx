import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './App'
import { AppErrorBoundary } from './shared/ui/AppErrorBoundary'

createRoot(document.getElementById('root')!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
)
