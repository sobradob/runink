import { useState } from 'react';

interface ExportSuccessModalProps {
  onClose: () => void;
  onOrderPrint: () => void;
  onRequestHd: (email: string, marketingOptIn: boolean) => Promise<void>;
}

/**
 * The free-export modal (BOA-125, 2026-06-27). Free exports are email-only:
 * this opens directly when the user clicks "Export" — there is no instant
 * download anymore. The user enters their email and we render a high-definition
 * poster server-side and email it after they confirm the address. Ordering a
 * print is offered as a secondary action.
 */
export function ExportSuccessModal({ onClose, onOrderPrint, onRequestHd }: ExportSuccessModalProps) {
  const [email, setEmail] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmitEmail = async () => {
    if (!email || !email.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }
    setSending(true);
    setError('');
    try {
      await onRequestHd(email, marketingOptIn);
      setSent(true);
      window.mixpanel?.track('hd_export_requested', {
        email_domain: email.split('@')[1],
        marketing_opt_in: marketingOptIn,
      });
    } catch (e) {
      setError((e as Error)?.message || 'Failed to send your poster');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm mx-4 mb-4 sm:mb-0 rounded-2xl bg-[#141414] border border-white/10 p-6 shadow-2xl">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-white/30 hover:text-white/60 text-lg leading-none"
        >
          &times;
        </button>

        {sent ? (
          <div className="text-center py-2">
            <div className="text-2xl mb-2">&#10003;</div>
            <h3
              className="text-base tracking-[0.12em] uppercase mb-1"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Check your email
            </h3>
            <p className="text-white/40 text-xs mb-5">
              We sent a confirmation link to <span className="text-white/70">{email}</span>.
              Click it and we'll render your high-definition poster and email it over.
            </p>
            <button
              onClick={() => {
                window.mixpanel?.track('export_upsell_print_clicked');
                onOrderPrint();
                onClose();
              }}
              className="w-full py-3 rounded-lg bg-white text-black font-medium text-sm tracking-wider uppercase hover:bg-white/90 transition-all"
            >
              Get it Printed — from $25
            </button>
          </div>
        ) : (
          <>
            {/* Primary action: email the HD poster */}
            <div className="text-center mb-5">
              <h3
                className="text-base tracking-[0.12em] uppercase mb-1"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Email me my poster
              </h3>
              <p className="text-white/40 text-xs">
                Enter your email and we'll send you a free high-definition poster.
              </p>
            </div>

            <div className="flex gap-2">
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={sending}
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitEmail()}
              />
              <button
                onClick={handleSubmitEmail}
                disabled={sending || !email}
                className="px-5 py-2.5 rounded-lg bg-white text-black text-sm font-medium hover:bg-white/90 disabled:opacity-50 transition-all whitespace-nowrap"
              >
                {sending ? '...' : 'Send'}
              </button>
            </div>
            <label className="flex items-center gap-2 mt-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={marketingOptIn}
                onChange={(e) => setMarketingOptIn(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 accent-white"
              />
              <span className="text-white/40 text-[11px]">
                Keep me posted on new themes and features
              </span>
            </label>
            {error && (
              <p className="text-red-400/80 text-[11px] mt-1.5">{error}</p>
            )}
            <p className="text-white/20 text-[10px] mt-2">
              300 DPI render, watermarked. Delivered after email confirmation.
            </p>

            {/* Secondary action: order a print */}
            <div className="border-t border-white/10 mt-5 pt-4">
              <button
                onClick={() => {
                  window.mixpanel?.track('export_upsell_print_clicked');
                  onOrderPrint();
                  onClose();
                }}
                className="w-full py-2.5 rounded-lg border border-white/15 text-white/80 font-medium text-sm tracking-wider uppercase hover:bg-white/5 hover:text-white transition-all"
              >
                Or get it printed — from $25
              </button>
              <p className="text-[10px] text-white/30 text-center mt-2">
                Premium matte paper, professionally printed and shipped to your door.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
