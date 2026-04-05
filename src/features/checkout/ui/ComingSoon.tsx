import { useEffect } from 'react';

/** Flip to false to re-enable the full order/payment flow */
export const COMING_SOON = true;

export function ComingSoonPopup({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    window.mixpanel?.track('coming_soon_popup_shown');
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-8 max-w-sm w-full mx-4 text-center">
        <div
          className="text-xl tracking-[0.2em] uppercase mb-3"
          style={{ fontFamily: 'var(--font-display)', color: 'white' }}
        >
          Coming Soon
        </div>
        <p className="text-white/60 text-sm leading-relaxed mb-6">
          We're putting the finishing touches on high-quality poster printing.
          Print ordering will be available shortly — stay tuned!
        </p>
        <button
          onClick={onClose}
          className="w-full py-3 rounded-lg bg-white/10 border border-white/20 text-white font-medium text-sm tracking-wider uppercase hover:bg-white/15 transition-all"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
