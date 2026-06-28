import { useState, useEffect } from 'react';

interface ExportInfo {
  exportId: string;
  status: string;
  pngUrl: string | null;
  expiresAt: string;
}

export function ExportDownloadPage({ exportId }: { exportId: string }) {
  const [info, setInfo] = useState<ExportInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      for (let i = 0; i < 60; i++) {
        try {
          const res = await fetch(`/api/export/${exportId}`);
          if (!res.ok) {
            if (res.status === 404) { setError('Export not found'); return; }
            throw new Error('Failed to fetch');
          }
          const data: ExportInfo = await res.json();
          if (cancelled) return;
          setInfo(data);

          if (data.status === 'ready' && data.pngUrl) {
            window.mixpanel?.track('hd_export_email_clicked', { export_id: exportId });
            return;
          }
          if (data.status === 'failed') {
            setError('Render failed — please try exporting again.');
            return;
          }
        } catch {
          if (cancelled) return;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (!cancelled) setError('Render is taking longer than expected. Please check back later.');
    };
    poll();
    return () => { cancelled = true; };
  }, [exportId]);

  const expired = info?.expiresAt && new Date(info.expiresAt) < new Date();

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        {error ? (
          <>
            <div className="text-3xl mb-4">&#9888;</div>
            <h2
              className="text-xl tracking-[0.15em] uppercase mb-3"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Export Unavailable
            </h2>
            <p className="text-white/40 text-sm mb-6">{error}</p>
            <a
              href="/"
              className="inline-block px-6 py-3 rounded-lg bg-white text-black font-medium text-sm tracking-wider uppercase hover:bg-white/90 transition-all"
            >
              Create a New Export
            </a>
          </>
        ) : expired ? (
          <>
            <h2
              className="text-xl tracking-[0.15em] uppercase mb-3"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Link Expired
            </h2>
            <p className="text-white/40 text-sm mb-6">
              This download link has expired. Create a new export from the editor.
            </p>
          </>
        ) : info?.status === 'ready' && info.pngUrl ? (
          <>
            <div className="text-3xl mb-4">&#10003;</div>
            <h2
              className="text-xl tracking-[0.15em] uppercase mb-3"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Your HD Poster
            </h2>
            <p className="text-white/40 text-sm mb-6">
              300 DPI, print-ready quality. Right-click or long-press to save.
            </p>
            <div className="mb-6 rounded-lg overflow-hidden border border-white/10">
              <img src={info.pngUrl} alt="Your HD poster" className="w-full" />
            </div>
            <a
              href={info.pngUrl}
              download={`runink-hd-${exportId}.png`}
              className="inline-block px-6 py-3 rounded-lg bg-white text-black font-medium text-sm tracking-wider uppercase hover:bg-white/90 transition-all mb-4"
            >
              Download HD Poster
            </a>
            <div className="border-t border-white/10 pt-5 mt-4">
              <p className="text-white/50 text-sm mb-3">Want it on your wall?</p>
              <a
                href="/"
                className="inline-block px-6 py-3 rounded-lg bg-white/10 border border-white/20 text-white font-medium text-sm tracking-wider uppercase hover:bg-white/15 transition-all"
              >
                Order a Print — from $25
              </a>
            </div>
          </>
        ) : (
          <>
            <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-4" />
            <h2
              className="text-xl tracking-[0.15em] uppercase mb-2"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Rendering Your Poster
            </h2>
            <p className="text-white/40 text-sm">
              Creating your high-definition poster at 300 DPI...
            </p>
            <p className="text-white/20 text-xs mt-2">This usually takes 1-2 minutes.</p>
          </>
        )}

        <div className="mt-6">
          <a href="/" className="text-white/30 text-xs hover:text-white/50">Back to RunInk</a>
        </div>
      </div>
    </div>
  );
}
