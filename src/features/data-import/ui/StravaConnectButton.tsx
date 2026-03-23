import type { StravaAuthStatus } from '../services/stravaLoader';

interface StravaConnectButtonProps {
  auth: StravaAuthStatus;
  loading: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
}

export function StravaConnectButton({ auth, loading, onConnect, onDisconnect, onRefresh }: StravaConnectButtonProps) {
  if (auth.connected) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/20">
          <StravaIcon />
          <span className="text-xs text-orange-400">{auth.athlete?.name}</span>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-xs px-2 py-1.5 rounded bg-white/5 text-white/40 hover:text-white/60 disabled:opacity-30"
          title="Refresh Strava data"
        >
          {loading ? '↻' : '↻'}
        </button>
        <button
          onClick={onDisconnect}
          className="text-xs px-2 py-1.5 rounded bg-white/5 text-white/30 hover:text-red-400"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={onConnect}
      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FC4C02] text-white text-sm font-medium hover:bg-[#E34402] transition-colors"
    >
      <StravaIcon />
      Connect with Strava
    </button>
  );
}

function StravaIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
    </svg>
  );
}
