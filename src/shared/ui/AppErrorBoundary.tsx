/**
 * Root-level error boundary. Anything that throws during render below
 * this lands in `componentDidCatch` and the user sees a recovery panel
 * instead of a blank screen.
 *
 * Why this matters for a consumer app: on mobile, a React render crash
 * leaves the page as a black void with no way to recover except force-
 * killing the tab — and most users won't know that's possible. The
 * recovery panel gives them a one-tap reload, surfaces the build SHA
 * so support can correlate, and offers the actual stack trace to copy
 * (the same workflow as DiagnosticOverlay) when the user wants to
 * report it.
 *
 * Limitations of React error boundaries:
 *   - Async errors in effects/handlers are NOT caught. We patch around
 *     this in service code with try/catch + RenderError instead.
 *   - SSR not applicable here (Vite SPA).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '@/shared/diagnostics/errorReporter';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Push to Mixpanel as `client_error { error_source: 'boundary' }`
    // so a React render crash surfaces in dashboards alongside every
    // other error. componentStack goes in `extra` rather than
    // overwriting the regular stack — both are useful when
    // diagnosing.
    console.error('[AppErrorBoundary]', error, info.componentStack);
    reportError(error, {
      source: 'boundary',
      extra: { component_stack: (info.componentStack ?? '').slice(0, 1500) },
    });
    this.setState({ componentStack: info.componentStack ?? null });
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <CrashRecovery
        error={this.state.error}
        componentStack={this.state.componentStack}
      />
    );
  }
}

function CrashRecovery({ error, componentStack }: { error: Error; componentStack: string | null }) {
  const report = [
    `RunInk crashed`,
    `Build: ${typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'unknown'} (${typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'unknown'})`,
    `URL: ${window.location.href}`,
    `Time: ${new Date().toISOString()}`,
    `UA: ${navigator.userAgent}`,
    ``,
    `Error: ${error.name}: ${error.message}`,
    error.stack ?? '(no stack)',
    ``,
    componentStack ?? '(no component stack)',
  ].join('\n');

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(report); } catch { /* old Safari */ }
  };
  const handleReload = () => {
    // Hard reload bypasses bfcache; if a stale JS bundle caused the
    // crash, the no-cache header on index.html will pull a fresh one.
    window.location.reload();
  };
  const handleHome = () => {
    window.location.href = '/';
  };

  return (
    <div className="min-h-dvh bg-[#0a0a0a] text-white/80 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-4xl mb-3">😖</div>
        <h1
          className="text-2xl tracking-[0.2em] uppercase mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Something broke
        </h1>
        <p className="text-sm text-white/60 leading-relaxed mb-5">
          RunInk hit an error it couldn't recover from. Your saved data
          is fine — nothing was lost. Most of the time, reloading fixes
          it.
        </p>

        <div className="space-y-2 mb-5">
          <button
            onClick={handleReload}
            className="w-full py-3 rounded-lg bg-white text-black font-medium text-sm tracking-wider uppercase hover:bg-white/90"
          >
            Reload
          </button>
          <button
            onClick={handleHome}
            className="w-full py-2 rounded-lg border border-white/15 text-sm text-white/70 hover:bg-white/5"
          >
            Go home
          </button>
        </div>

        <details className="text-xs text-white/40">
          <summary className="cursor-pointer hover:text-white/60 select-none">
            Show error details
          </summary>
          <pre className="mt-2 p-3 rounded-md bg-black/40 border border-white/5 text-[10px] leading-snug whitespace-pre-wrap break-all max-h-72 overflow-auto font-mono">
            {report}
          </pre>
          <button
            onClick={handleCopy}
            className="mt-2 text-xs text-white/50 hover:text-white underline underline-offset-2"
          >
            Copy report
          </button>
        </details>
      </div>
    </div>
  );
}
