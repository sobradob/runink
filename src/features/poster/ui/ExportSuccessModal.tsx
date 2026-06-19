import { useState } from 'react';

interface ExportSuccessModalProps {
  onClose: () => void;
  onOrderPrint: () => void;
  onRequestHd: (email: string, marketingOptIn: boolean) => Promise<void>;
}

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
      setError((e as Error)?.message || 'Failed to request HD version');
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

        <div className="text-center mb-5">
          <div className="text-2xl mb-2">&#10003;</div>
          <h3
            className="text-base tracking-[0.12em] uppercase mb-1"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Poster Downloaded
          </h3>
          <p className="text-white/40 text-xs">Your preview image has been saved.</p>
        </div>

        {/* Print upsell */}
        <button
          onClick={() => {
            window.mixpanel?.track('export_upsell_print_clicked');
            onOrderPrint();
            onClose();
          }}
          className="w-full py-3 rounded-lg bg-white text-black font-medium text-sm tracking-wider uppercase hover:bg-white/90 transition-all mb-3"
        >
          Get it Printed — from $25
        </button>
        <p className="text-[10px] text-white/30 text-center mb-5">
          Premium matte paper, professionally printed and shipped to your door.
        </p>

        {/* HD email delivery */}
        <div className="border-t border-white/10 pt-4">
          {sent ? (
            <div className="text-center">
              <p className="text-emerald-400 text-sm font-medium mb-1">Check your email!</p>
              <p className="text-white/40 text-[11px]">
                We sent a confirmation link. Click it to start rendering your HD poster.
              </p>
            </div>
          ) : (
            <>
              <p className="text-white/50 text-xs mb-2.5 text-center">
                Want the high-definition version? Free — we'll email it to you.
              </p>
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
                  className="px-4 py-2.5 rounded-lg bg-white/10 border border-white/20 text-white text-sm font-medium hover:bg-white/15 disabled:opacity-50 transition-all whitespace-nowrap"
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
              <p className="text-white/20 text-[10px] mt-2 text-center">
                300 DPI render, watermarked. Delivered after email confirmation.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
