import { useState, useEffect, lazy, Suspense } from 'react';
import axios from 'axios';
import { useI18n } from '../useI18n';

const AnalysisResult = lazy(() => import('./AnalysisResult'));

function SkeletonCards() {
  return (
    <div className="space-y-4 animate-fade-in">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-xl border border-white/5 bg-surface-card/60 p-5 animate-fade-in"
        >
          <div className="h-4 w-1/3 bg-white/5 rounded mb-3" />
          <div className="space-y-2">
            <div className="h-3 w-full bg-white/5 rounded" />
            <div className="h-3 w-5/6 bg-white/5 rounded" />
            <div className="h-3 w-2/3 bg-white/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function SharedAnalysis({ shareId }) {
  const { lang } = useI18n();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchAnalysis = async () => {
      try {
        const res = await axios.get(`/api/share/${shareId}`);
        if (!cancelled) {
          setData(res.data);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError(true);
          setLoading(false);
        }
      }
    };

    fetchAnalysis();

    return () => {
      cancelled = true;
    };
  }, [shareId]);

  // ---------- Loading ----------
  if (loading) {
    return (
      <div className="min-h-screen bg-bg text-text">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
          {/* Header skeleton */}
          <div className="mb-8">
            <div className="h-6 w-40 bg-white/5 rounded mb-2" />
            <div className="h-4 w-64 bg-white/5 rounded" />
          </div>
          <SkeletonCards />
        </div>
      </div>
    );
  }

  // ---------- Error / 404 ----------
  if (error || !data) {
    return (
      <div className="min-h-screen bg-bg text-text flex items-center justify-center">
        <div className="rounded-xl border border-white/10 bg-surface-card/80 p-8 max-w-md w-full text-center space-y-4 animate-fade-in">
          {/* Warning icon */}
          <svg
            className="mx-auto w-10 h-10 text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>

          <h2 className="text-lg font-semibold text-text">
            {lang === 'pt'
              ? 'Análise não encontrada ou expirada'
              : 'Analysis not found or expired'}
          </h2>

          <p className="text-sm text-text-muted">
            {lang === 'pt'
              ? 'O link que seguiu pode estar incorreto ou a análise já expirou.'
              : 'The link you followed may be incorrect or the analysis has expired.'}
          </p>

          <a
            href="/"
            className="inline-flex items-center gap-2 mt-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary hover:bg-primary-hover text-white transition-colors"
          >
            {lang === 'pt' ? '← Voltar ao início' : '← Back to home'}
          </a>
        </div>
      </div>
    );
  }

  // ---------- Success ----------
  return (
    <div className="min-h-screen bg-bg text-text">
      {/* Header */}
      <header className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <a href="/" className="inline-block mb-1">
              <span className="text-xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                RepoLens
              </span>
            </a>
            <p className="text-sm text-text-muted truncate max-w-md" title={data.repoUrl}>
              {data.repoUrl}
            </p>
          </div>

          <a
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary hover:bg-primary-hover text-white transition-colors whitespace-nowrap"
          >
            {lang === 'pt' ? 'Experimentar RepoLens' : 'Try RepoLens'}
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 7l5 5m0 0l-5 5m5-5H6"
              />
            </svg>
          </a>
        </div>

        {/* Shared analysis content */}
        <Suspense fallback={<SkeletonCards />}>
          <AnalysisResult
            analysis={data.analysisResult}
            loading={false}
            duration={0}
            repoName={data.repoUrl}
          />
        </Suspense>
      </header>
    </div>
  );
}

export default SharedAnalysis;
