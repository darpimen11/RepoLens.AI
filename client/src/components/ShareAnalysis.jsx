import { useState } from 'react';
import axios from 'axios';
import { useI18n } from '../useI18n';

function ShareAnalysis({ analysis, repoUrl }) {
  const { lang } = useI18n();
  const [state, setState] = useState('idle'); // idle | loading | success | error
  const [shareUrl, setShareUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleShare = async () => {
    if (state === 'loading') return;

    setState('loading');
    setErrorMsg('');

    try {
      const res = await axios.post('/api/share/save', {
        repoUrl,
        analysisResult: analysis,
        summary: analysis.substring(0, 500),
        strengths: '',
        weaknesses: '',
      });

      const fullUrl = `${window.location.origin}/share/${res.data.id}`;
      setShareUrl(fullUrl);
      setState('success');

      try {
        await navigator.clipboard.writeText(fullUrl);
      } catch {
        // Clipboard write may fail in some contexts; ignore silently
      }

      setTimeout(() => {
        setState('idle');
        setShareUrl('');
      }, 5000);
    } catch (err) {
      const msg =
        err.response?.data?.error ||
        (lang === 'pt' ? 'Erro ao partilhar' : 'Failed to share');
      setErrorMsg(msg);
      setState('error');

      setTimeout(() => {
        setState('idle');
        setErrorMsg('');
      }, 3000);
    }
  };

  if (state === 'success') {
    return (
      <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 animate-fade-in">
        {/* Checkmark icon */}
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        {lang === 'pt' ? 'Link copiado!' : 'Link copied!'}
      </span>
    );
  }

  return (
    <div className="relative inline-flex flex-col items-end">
      <button
        type="button"
        disabled={state === 'loading'}
        onClick={handleShare}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer bg-surface-light/80 border border-white/10 text-text-muted hover:text-text hover:border-white/20 hover:bg-surface-light ${
          state === 'loading' ? 'opacity-60 cursor-wait' : ''
        }`}
      >
        {state === 'loading' ? (
          /* Spinner */
          <svg
            className="w-3.5 h-3.5 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
            />
          </svg>
        ) : (
          /* Share icon */
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 8a3 3 0 10-2.977-2.63l-4.94 2.47a3 3 0 100 4.319l4.94 2.47a3 3 0 10.895-1.789l-4.94-2.47a3.027 3.027 0 000-.74l4.94-2.47C13.456 7.68 14.19 8 15 8z"
            />
          </svg>
        )}
        {lang === 'pt' ? 'Partilhar' : 'Share'}
      </button>

      {/* Inline error toast */}
      {state === 'error' && errorMsg && (
        <span className="absolute top-full mt-1 right-0 whitespace-nowrap text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-2 py-1 animate-fade-in">
          {errorMsg}
        </span>
      )}
    </div>
  );
}

export default ShareAnalysis;
