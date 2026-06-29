import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import RepoForm from "./components/RepoForm";
import HeroOrb from "./components/HeroOrb";
import RepoErrorCard from "./components/RepoErrorCard";
import { useI18n } from "./useI18n";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import axios from "axios";

// API Key Management
import { useUsageTracker } from "./hooks/useUsageTracker";
import { analyzeRepository } from "./lib/geminiClient";
import { validateRepoBeforeAnalysis } from "./lib/githubClient";
import { StorageSync } from "./lib/apiKeyStorage";
import { API_CONFIG } from "./constants/config";

// Lazy-loaded heavy components
const ArchitectureGraph = lazy(() => import("./components/ArchitectureGraph"));
const RepoPersonality = lazy(() => import("./components/RepoPersonality"));
const CopilotBanner = lazy(() => import("./components/CopilotBanner"));
const AnalysisResult = lazy(() => import("./components/AnalysisResult"));
const RepoStats = lazy(() => import("./components/RepoStats"));
const ApiKeyModal = lazy(() => import("./components/ApiKeyModal").then(m => ({ default: m.ApiKeyModal })));
const UsageIndicator = lazy(() => import("./components/UsageIndicator").then(m => ({ default: m.UsageIndicator })));
const ApiKeySettings = lazy(() => import("./components/ApiKeySettings").then(m => ({ default: m.ApiKeySettings })));
const ShareAnalysis = lazy(() => import("./components/ShareAnalysis"));
const SharedAnalysis = lazy(() => import("./components/SharedAnalysis"));

const HISTORY_KEY = "repolens-history";
const AI_OUTAGE_KEY = "repolens-ai-outage";
const MAX_HISTORY = 5;

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch { return []; }
}

function saveToHistory(entry) {
  try {
    const history = loadHistory().filter((h) => h.url !== entry.url);
    history.unshift(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    // Keep app stable if storage is unavailable
  }
}

function loadServiceUnavailable() {
  try {
    const stored = JSON.parse(localStorage.getItem(AI_OUTAGE_KEY) || "null");
    if (!stored?.until) return null;
    if (stored.until <= Date.now()) {
      localStorage.removeItem(AI_OUTAGE_KEY);
      return null;
    }
    return stored;
  } catch {
    return null;
  }
}

function persistServiceUnavailable(state) {
  try {
    if (state?.until && state.until > Date.now()) {
      localStorage.setItem(AI_OUTAGE_KEY, JSON.stringify(state));
      return;
    }

    localStorage.removeItem(AI_OUTAGE_KEY);
  } catch {
    // Keep app stable if storage is unavailable
  }
}

function AppMain() {
  const [analysis, setAnalysis] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [repoErrorType, setRepoErrorType] = useState(null);
  const [currentRepoUrl, setCurrentRepoUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [history, setHistory] = useState(loadHistory);
  const [analysisLang, setAnalysisLang] = useState("");
  const [lastFromCache, setLastFromCache] = useState(false);
  const [cacheAgeHours, setCacheAgeHours] = useState(null);
  const [sharedRepoData, setSharedRepoData] = useState(null);
  const [serviceUnavailable, setServiceUnavailable] = useState(loadServiceUnavailable);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [pendingRepoValidation, setPendingRepoValidation] = useState(null);
  const fetchedRepoRef = useRef("");
  const { t, lang, toggleLang } = useI18n();
  const { canMakeRequest, incrementUsage, hasUserKey, setHasUserKey } = useUsageTracker();

  const langMismatch = analysis && analysisLang && lang !== analysisLang;
  const serviceDisabled = Boolean(serviceUnavailable?.until && serviceUnavailable.until > Date.now());

  const repoName = currentRepoUrl.match(/github\.com\/([^/]+\/[^/]+)/)?.[1] || "";
  const heroStats = [
    { value: "6", label: lang === "pt" ? "camadas de leitura" : "analysis layers" },
    { value: "<10s", label: lang === "pt" ? "tempo alvo" : "target turnaround" },
    { value: "SVG", label: lang === "pt" ? "visuais nativos" : "native visuals" },
  ];
  const heroSignals = [
    lang === "pt" ? "arquitetura" : "architecture",
    lang === "pt" ? "stack" : "stack",
    lang === "pt" ? "saúde do repo" : "repo health",
  ];

  useEffect(() => {
    try {
      const rawUsage = localStorage.getItem(API_CONFIG.STORAGE_KEYS.USAGE);

      if (!rawUsage) {
        const initial = { count: API_CONFIG.MAX_FREE_REQUESTS, lastReset: Date.now() };
        localStorage.setItem(API_CONFIG.STORAGE_KEYS.USAGE, JSON.stringify(initial));
        console.log("[usage] initialized", initial);
        window.dispatchEvent(new CustomEvent(StorageSync.EVENT_NAME));
        return;
      }

      const usage = JSON.parse(rawUsage);
      const lastReset = Number(usage?.lastReset || usage?.lastResetAt || 0);
      const hoursSinceReset = lastReset ? (Date.now() - lastReset) / 3600000 : Infinity;
      console.log("[usage] hours since reset", hoursSinceReset);

      if (hoursSinceReset >= 24) {
        const resetData = { count: API_CONFIG.MAX_FREE_REQUESTS, lastReset: Date.now() };
        localStorage.setItem(API_CONFIG.STORAGE_KEYS.USAGE, JSON.stringify(resetData));
        console.log("[usage] auto reset executed", resetData);
        window.dispatchEvent(new CustomEvent(StorageSync.EVENT_NAME));
      }
    } catch (error) {
      console.log("[usage] reset check failed", error);
    }
  }, []);

  useEffect(() => {
    try {
      const key = localStorage.getItem(API_CONFIG.STORAGE_KEYS.USER_API_KEY);
      if (key) {
        setHasUserKey(true);
        console.log("[api-key] key restored from localStorage");
      }
    } catch (error) {
      console.log("[api-key] restore failed", error);
    }
  }, [setHasUserKey]);

  useEffect(() => {
    let active = true;

    const syncServiceStatus = async () => {
      try {
        const res = await axios.get("/api/status", {
          params: { lang },
          validateStatus: (status) => status === 200 || status === 503,
        });

        if (!active) return;

        const outage = res.data?.serviceUnavailable || null;
        if (res.status === 503 && outage) {
          setServiceUnavailable(outage);
          persistServiceUnavailable(outage);
          return;
        }

        setServiceUnavailable(null);
        persistServiceUnavailable(null);
      } catch {
        // Keep last known state if status check fails.
      }
    };

    syncServiceStatus();
    const interval = window.setInterval(syncServiceStatus, serviceDisabled ? 15000 : 60000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [lang, serviceDisabled]);

  // Shared GitHub API fetch — feeds both RepoStats and RepoPersonality
  useEffect(() => {
    if (!currentRepoUrl) return;
    const match = currentRepoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) return;
    if (fetchedRepoRef.current === currentRepoUrl) return;
    fetchedRepoRef.current = currentRepoUrl;
    setSharedRepoData(null);

    const [, owner, repo] = match;
    fetch(`https://api.github.com/repos/${owner}/${repo.replace(/\.git$/, "")}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setSharedRepoData(data); })
      .catch(() => {});
  }, [currentRepoUrl]);

  const handleAnalyze = async (repoUrl, options = {}) => {
    if (serviceDisabled) return;

    // Check if user can make request (free limit or has personal key)
    if (!canMakeRequest) {
      setShowApiKeyModal(true);
      return;
    }
    
    setAnalysis("");
    setError("");
    setRepoErrorType(null);
    setDuration(0);
    setLastFromCache(false);
    setCacheAgeHours(null);
    if (!options.keepPending) {
      setPendingRepoValidation(null);
    }

    const start = Date.now();

    try {
      const validation = options.prevalidated || await validateRepoBeforeAnalysis(repoUrl);
      if (!validation.canProceed) {
        setRepoErrorType(validation.error || "API_ERROR");
        const messageByType = {
          INVALID_FORMAT: t("repo.validation.invalidFormat"),
          NOT_FOUND: "Repositório não encontrado ou é privado",
          NETWORK_ERROR: t("repo.validation.network"),
          FORBIDDEN: "Rate limit do GitHub. Tente em 1 min",
          PRIVATE: "Este repositório é privado. Análise indisponível.",
          EMPTY: "Repositório vazio. Não há código para analisar.",
        };
        throw new Error(messageByType[validation.error] || t("repo.validation.generic"));
      }

      if (!options.confirmed) {
        setPendingRepoValidation(validation);
        return;
      }

      const normalizedRepoUrl = validation.repoUrl;
      setCurrentRepoUrl(normalizedRepoUrl);
      setPendingRepoValidation(null);
      setLoading(true);

      const result = await analyzeRepository(normalizedRepoUrl, lang, options);
      const elapsed = Date.now() - start;
      setDuration(elapsed);
      setAnalysis(result.analysis);
      setAnalysisLang(lang);
      setServiceUnavailable(null);
      persistServiceUnavailable(null);

      // Show cache indication if data came from cache
      if (result.fromCache) {
        toast.info(t("analysis.fromCache", "Analysis loaded from cache."));
      }
      setLastFromCache(Boolean(result.fromCache));
      setCacheAgeHours(Number.isFinite(result.cachedHours) ? result.cachedHours : null);

      // Increment usage ONLY if NOT using a personal key
      if (!result.isUserKey && !result.fromCache) {
        incrementUsage();
      }

      saveToHistory({
        url: normalizedRepoUrl,
        name: validation.repoPath,
        date: new Date().toISOString()
      });
      setHistory(loadHistory());

      // Scroll to results after a brief delay
      setTimeout(() => {
        document.getElementById("analysis-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
    } catch (err) {
      setDuration(Date.now() - start);
      
      // Handle Axios vs Fetch errors
      const backendError = err.response?.data || (err.message && { error: err.message });

      if (backendError?.code === "AI_TEMPORARILY_UNAVAILABLE") {
        const outage = backendError?.serviceUnavailable || null;
        setServiceUnavailable(outage);
        persistServiceUnavailable(outage);
        setError([backendError.error, backendError.message, backendError.hint].filter(Boolean).join("\n"));
        return;
      }

      let message = backendError?.error || err.message || "Error analyzing repository.";
      if (typeof message === "object") message = JSON.stringify(message);
      let details = backendError?.details || "";
      if (typeof details === "object") details = JSON.stringify(details);
      const hint = backendError?.hint ? `\n${backendError.hint}` : "";
      setError(`${message}${details ? "\n" + details : ""}${hint}`);
    } finally {
      setLoading(false);
    }
  };

  const handleHistoryClick = (url) => {
    if (serviceDisabled) return;
    handleAnalyze(url);
  };

  const clearHistory = () => {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // Keep app stable if storage is unavailable
    }
    setHistory([]);
  };

  return (
    <div className="min-h-screen bg-surface">
      {/* Skip to content */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[60] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-primary focus:text-white focus:outline-none">
        Skip to main content
      </a>

      {/* Header */}
      <header className="border-b border-white/[0.06] glass sticky top-0 z-50" role="banner">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-lg shadow-primary/20 ring-1 ring-white/10">
              <svg className="w-[18px] h-[18px] text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                <circle cx="11" cy="11" r="3" opacity="0.5" />
              </svg>
            </div>
            <div>
              <h1 className="text-lg font-bold text-text tracking-tight font-display">
                Repo<span className="text-primary-light">Lens</span> <span className="text-text-muted font-normal text-sm">AI</span>
              </h1>
              <p className="text-[10px] text-text-muted/70 hidden sm:block tracking-[0.15em] uppercase">
                {t("header.subtitle")}
              </p>
            </div>
          </div>

          <nav className="ml-auto flex items-center gap-2" aria-label="Site navigation">
            <Suspense fallback={<div className="w-24 h-8 bg-white/5 rounded-full animate-pulse" />}>
              <UsageIndicator />
            </Suspense>
            <button
              onClick={() => setShowApiKeyModal(true)}
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[11px] font-semibold text-text-muted hover:text-text hover:border-primary/30 transition-all cursor-pointer"
            >
              🔑 {t("apiKey.cta.use")}
            </button>
            {/* Language Toggle */}
            <button
              onClick={toggleLang}
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:border-primary/30 hover:bg-primary/5 transition-all cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              title={lang === "en" ? "Mudar para Português" : "Switch to English"}
              aria-label={lang === "en" ? "Switch to Portuguese" : "Mudar para Inglês"}
            >
              <span className="text-[10px] font-bold" aria-hidden="true">{lang === "en" ? "EN" : "PT"}</span>
            </button>
            {/* LinkedIn — visible after 2026-02-16 15:10 BRT */}
            {Date.now() >= new Date("2026-02-16T15:10:00-03:00").getTime() && (
            <a
              href="https://linkedin.com/in/darpimen11"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.08] text-text-muted hover:text-[#0A66C2] hover:border-[#0A66C2]/30 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              title="LinkedIn"
              aria-label="Visit LinkedIn profile"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
            </a>
            )}
            <a
              href="https://github.com/darpimen11/RepoLens.AI"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.08] text-text-muted hover:text-text hover:border-white/20 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              title="GitHub"
              aria-label="View source on GitHub"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
            </a>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <main id="main-content" className="max-w-6xl mx-auto px-4 sm:px-6" role="main">
        <section className="py-12 sm:py-18 lg:py-22 relative">
          <HeroOrb />
          <div className="accent-orbit top-14 left-[10%] w-36 h-36 bg-primary/18" />
          <div className="accent-orbit right-[6%] top-40 w-44 h-44 bg-accent/12" />

          <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-10 xl:gap-14 items-start">
            <div className="relative z-10">
              <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-primary/[0.08] border border-primary/[0.15] text-primary-light text-xs font-medium mb-8 backdrop-blur-sm animate-fade-in">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-60"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
                </span>
                {t("header.badge")}
              </div>

              <p className="text-[11px] uppercase tracking-[0.32em] text-text-muted/70 mb-5 eyebrow-line animate-fade-in">
                {lang === "pt" ? "Inteligência de repositórios em linguagem humana" : "Repository intelligence in human language"}
              </p>
              <h2 className="font-display text-[2.8rem] sm:text-[4.6rem] lg:text-[5.6rem] font-semibold text-text leading-[0.95] mb-6 tracking-[-0.03em] animate-fade-in" style={{ animationDelay: '100ms' }}>
                {t("hero.title1")}
                <br />
                <span className="bg-gradient-to-r from-primary-light via-[#ffe2c6] to-accent bg-clip-text text-transparent animate-gradient bg-[length:200%_auto]">
                  {t("hero.title2")}
                </span>
              </h2>
              <p className="text-text-muted max-w-2xl mb-10 text-base sm:text-lg leading-relaxed animate-fade-in" style={{ animationDelay: '200ms' }}>
                {t("hero.desc")}
              </p>

              <div className="flex flex-wrap gap-3 mb-10 animate-fade-in" style={{ animationDelay: '260ms' }}>
                {heroSignals.map((signal) => (
                  <span key={signal} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full panel-metal text-xs uppercase tracking-[0.2em] text-text-muted/85">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary-light" />
                    {signal}
                  </span>
                ))}
              </div>

              {serviceDisabled && (
            <div role="status" aria-live="polite" className="animate-fade-in max-w-2xl mb-5 p-4 rounded-[1.6rem] bg-warning/[0.08] border border-warning/15 text-left backdrop-blur-sm">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 shrink-0 mt-0.5 text-warning" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4m0 4h.01M4.93 19h14.14c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.198 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>
                  <p className="text-sm font-semibold text-text">{t("service.title")}</p>
                  <p className="text-sm text-text-muted mt-1">
                    {t("service.description")}
                  </p>
                  <p className="text-xs text-text-muted/75 mt-2">
                    {serviceUnavailable?.placeholder || t("service.placeholder")}
                  </p>
                </div>
              </div>
            </div>
          )}

              <Suspense fallback={null}>
                <ApiKeySettings />
              </Suspense>
              
              {!hasUserKey && (
                <div className="animate-fade-in max-w-3xl mx-auto mb-8 p-6 rounded-[2rem] bg-primary/[0.04] border border-primary/10 backdrop-blur-sm text-center">
                   <p className="text-sm text-text-muted leading-relaxed">
                     ⚡ {t("apiKey.banner.info")}
                     <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="ml-2 text-primary-light hover:text-primary underline font-medium transition-all">
                        {t("apiKey.banner.link")} →
                     </a>
                   </p>
                </div>
              )}

              <div className="flex justify-center mb-6">
                <button
                  onClick={() => setShowApiKeyModal(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-xs font-semibold text-text-muted hover:text-text hover:border-primary/30 transition-all cursor-pointer"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                  {hasUserKey
                    ? t("apiKey.cta.update")
                    : t("apiKey.cta.use")}
                </button>
              </div>

              <RepoForm
                onAnalyze={handleAnalyze}
                loading={loading}
                disabled={serviceDisabled}
                disabledPlaceholder={serviceUnavailable?.placeholder || t("service.placeholder")}
                disabledReason={t("service.description")}
              />

              {pendingRepoValidation?.repoData && (
                <div className="animate-fade-in mt-5 max-w-3xl mx-auto p-5 rounded-[1.6rem] bg-white/[0.03] border border-white/[0.08]">
                  <p className="text-xs uppercase tracking-[0.2em] text-text-muted/70 mb-3">
                    {lang === "pt" ? "Preview do repositório" : "Repository preview"}
                  </p>
                  <div className="space-y-1.5 text-sm text-text-muted">
                    <p><span className="text-text font-semibold">Nome:</span> {pendingRepoValidation.repoData.full_name}</p>
                    <p><span className="text-text font-semibold">Descrição:</span> {pendingRepoValidation.repoData.description || "—"}</p>
                    <p><span className="text-text font-semibold">Linguagem:</span> {pendingRepoValidation.repoData.language || "—"}</p>
                    <p><span className="text-text font-semibold">Stars/Forks:</span> {pendingRepoValidation.repoData.stargazers_count || 0} / {pendingRepoValidation.repoData.forks_count || 0}</p>
                    <p><span className="text-text font-semibold">Atualizado:</span> {new Date(pendingRepoValidation.repoData.updated_at).toLocaleString()}</p>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => handleAnalyze(pendingRepoValidation.repoPath, { confirmed: true, prevalidated: pendingRepoValidation, keepPending: true })}
                      className="px-4 py-2 rounded-lg text-xs font-semibold bg-primary/20 border border-primary/30 text-primary-light hover:bg-primary/30 transition-all cursor-pointer"
                    >
                      {lang === "pt" ? "Confirmar análise" : "Confirm analysis"}
                    </button>
                    <button
                      onClick={() => setPendingRepoValidation(null)}
                      className="px-4 py-2 rounded-lg text-xs font-semibold bg-white/[0.03] border border-white/[0.08] text-text-muted hover:text-text transition-all cursor-pointer"
                    >
                      {lang === "pt" ? "Cancelar" : "Cancel"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="relative animate-fade-in-scale" style={{ animationDelay: '220ms' }}>
              <div className="hero-card rounded-[2rem] p-6 sm:p-7 editorial-grid overflow-hidden">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.3em] text-text-muted/60 mb-2">
                      {lang === "pt" ? "Sala de controlo" : "control room"}
                    </p>
                    <h3 className="font-display text-2xl sm:text-3xl text-text">
                      {lang === "pt" ? "Leituras rápidas com aura de relatório premium" : "Fast reads with premium-report energy"}
                    </h3>
                  </div>
                  <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/20 border border-white/8 text-[10px] uppercase tracking-[0.26em] text-accent">
                    live
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-6">
                  {heroStats.map((item) => (
                    <div key={item.label} className="rounded-[1.3rem] bg-black/20 border border-white/8 px-4 py-4">
                      <p className="text-xl sm:text-2xl font-bold text-text mb-1">{item.value}</p>
                      <p className="text-[10px] uppercase tracking-[0.22em] text-text-muted/72">{item.label}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-[1.5rem] bg-black/25 border border-white/8 p-4 sm:p-5 mb-4">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[10px] uppercase tracking-[0.3em] text-text-muted/65">
                      {lang === "pt" ? "Painel de análise" : "analysis panel"}
                    </span>
                    <span className="text-[10px] px-2 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary-light uppercase tracking-[0.18em]">
                      {lang === "pt" ? "profundo" : "deep"}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {[
                      lang === "pt" ? "Resumo arquitetural com contexto" : "Architectural summary with context",
                      lang === "pt" ? "Stack lida como mapa de decisão" : "Stack framed as a decision map",
                      lang === "pt" ? "Sinais fortes, fracos e próximas ações" : "Strengths, weaknesses and next actions",
                    ].map((line, index) => (
                      <div key={line} className="flex items-center gap-3">
                        <span className={`w-2 h-2 rounded-full ${index === 0 ? "bg-primary-light" : index === 1 ? "bg-accent" : "bg-accent-green"}`} />
                        <span className="text-sm text-text-muted">{line}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div className="rounded-[1.4rem] bg-white/[0.03] border border-white/8 p-4">
                    <p className="text-[10px] uppercase tracking-[0.26em] text-text-muted/65 mb-2">
                      {lang === "pt" ? "Experiência" : "experience"}
                    </p>
                    <p className="text-sm text-text-muted leading-relaxed">
                      {lang === "pt"
                        ? "Uma composição mais editorial, com contraste alto, profundidade e leitura mais imediata."
                        : "A more editorial composition with stronger contrast, depth and faster scanability."}
                    </p>
                  </div>
                  <div className="rounded-[1.4rem] bg-white/[0.03] border border-white/8 p-4">
                    <p className="text-[10px] uppercase tracking-[0.26em] text-text-muted/65 mb-2">
                      {lang === "pt" ? "Assinatura visual" : "visual signature"}
                    </p>
                    <p className="text-sm text-text-muted leading-relaxed">
                      {lang === "pt"
                        ? "Bronze quente, ciano oxidado, vidro escuro e tipografia de revista técnica."
                        : "Warm bronze, oxidized cyan, dark glass and technical-magazine typography."}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Recent History */}
          {history.length > 0 && !loading && !analysis && (
            <div className="animate-fade-in mt-12 max-w-4xl" style={{ animationDelay: '400ms' }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] text-text-muted/70 uppercase tracking-[0.26em] font-medium">{t("history.title")}</span>
                <button
                  onClick={clearHistory}
                  className="text-[10px] text-text-muted/40 hover:text-danger transition-colors cursor-pointer"
                >
                  {t("history.clear")}
                </button>
              </div>
              <div className="flex flex-wrap gap-3">
                {history.slice(0, 5).map((item) => (
                  <button
                    key={item.url}
                    onClick={() => handleHistoryClick(item.url)}
                    className="flex items-center gap-2 px-4 py-3 rounded-[1.1rem] panel-metal text-xs text-text-muted hover:text-text hover:border-primary/25 hover:bg-primary/[0.04] transition-all cursor-pointer group"
                  >
                    <svg className="w-3.5 h-3.5 text-text-muted/40 group-hover:text-primary-light transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="font-medium">{item.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Error */}
        {repoErrorType && (
          <RepoErrorCard
            type={repoErrorType}
            onRetry={() => {
              setRepoErrorType(null);
              setError("");
            }}
            onUseExample={(repo) => {
              setRepoErrorType(null);
              setError("");
              handleAnalyze(repo);
            }}
          />
        )}

        {error && !repoErrorType && (
          <div role="alert" aria-live="assertive" className="animate-fade-in max-w-3xl mx-auto mb-8 p-4 rounded-[1.5rem] bg-danger/[0.08] border border-danger/15 text-danger text-sm backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <div>
                <p className="font-semibold mb-1">{t("error.title")}</p>
                <p className="whitespace-pre-wrap opacity-80">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Repo Stats */}
        <Suspense fallback={<div className="skeleton h-32 max-w-3xl mx-auto mb-8 rounded-2xl" />}>
          <RepoStats repoUrl={currentRepoUrl} visible={!!(analysis || loading)} repoData={sharedRepoData} />
        </Suspense>

        {/* Architecture Graph */}
        <Suspense fallback={<div className="skeleton h-64 max-w-3xl mx-auto mb-8 rounded-2xl" />}>
          <ArchitectureGraph repoUrl={currentRepoUrl} visible={!!(analysis || loading)} />
        </Suspense>

        {/* Repo Personality */}
        <Suspense fallback={<div className="skeleton h-48 max-w-3xl mx-auto mb-8 rounded-2xl" />}>
          <RepoPersonality repoUrl={currentRepoUrl} visible={!!analysis} repoData={sharedRepoData} />
        </Suspense>

        {/* Language mismatch banner */}
        {langMismatch && (
          <div className="max-w-4xl lg:max-w-5xl mx-auto mb-4 animate-fade-in">
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-warning/[0.08] border border-warning/15 text-sm backdrop-blur-sm">
              <svg className="w-4.5 h-4.5 text-warning shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-text-muted text-xs flex-1">
                {t("analysis.langMismatch")}
              </span>
              <button
                onClick={() => handleAnalyze(currentRepoUrl, { forceRefresh: true })}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/15 border border-primary/25 text-primary-light hover:bg-primary/25 transition-all cursor-pointer"
              >
                {t("analysis.reAnalyze")}
              </button>
            </div>
          </div>
        )}

        {analysis && lastFromCache && (
          <div className="max-w-4xl lg:max-w-5xl mx-auto mb-4 animate-fade-in">
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/[0.08] border border-primary/20 text-sm backdrop-blur-sm">
              <span className="text-xs text-primary-light">⚡ {t("analysis.cache.badge")}</span>
              <span className="text-text-muted text-xs flex-1">
                {cacheAgeHours !== null
                  ? `${t("analysis.cache.desc")} (${Math.max(0, Math.floor(cacheAgeHours))}${lang === "pt" ? "h atrás" : "h ago"})`
                  : t("analysis.cache.desc")}
              </span>
              <button
                onClick={() => handleAnalyze(currentRepoUrl, { forceRefresh: true })}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary/15 border border-primary/25 text-primary-light hover:bg-primary/25 transition-all cursor-pointer"
              >
                {t("analysis.cache.refresh")}
              </button>
            </div>
          </div>
        )}

        {/* Results */}
        {analysis && !loading && (
          <div className="max-w-3xl md:max-w-5xl mx-auto flex justify-end mb-2">
            <Suspense fallback={null}>
              <ShareAnalysis analysis={analysis} repoUrl={currentRepoUrl} />
            </Suspense>
          </div>
        )}
        <Suspense fallback={<div className="max-w-3xl mx-auto space-y-4"><div className="skeleton h-48 rounded-2xl" /><div className="skeleton h-48 rounded-2xl" /></div>}>
          <AnalysisResult analysis={analysis} loading={loading} duration={duration} repoName={repoName} />
        </Suspense>

        {/* Copilot CLI Showcase — temporary until 2026-02-16 15:00 BRT */}
        <Suspense fallback={null}>
          {analysis && Date.now() < new Date("2026-02-16T15:00:00-03:00").getTime() && <CopilotBanner />}
        </Suspense>
      </main>

      {/* Footer */}
      <footer className="relative border-t border-white/[0.06] mt-24 overflow-hidden" role="contentinfo">
        <div className="absolute inset-0 bg-gradient-to-t from-primary/[0.02] to-transparent pointer-events-none" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
          <div className="flex flex-col items-center gap-5 panel-metal rounded-[1.9rem] px-6 py-10">
            {/* Logo */}
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-lg shadow-primary/15 ring-1 ring-white/10">
                <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </div>
              <span className="font-display font-bold text-text text-sm">
                Repo<span className="text-primary-light">Lens</span> <span className="text-text-muted font-normal text-xs">AI</span>
              </span>
            </div>

            {/* Divider */}
            <div className="w-12 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" aria-hidden="true" />

            <p className="text-text-muted text-xs tracking-wide">
              {t("footer.builtWith")} &bull; {t("footer.challenge")}
            </p>

            <div className="flex items-center gap-3">
              <span className="text-text-muted/50 text-xs">{t("footer.author")}</span>
              {/* LinkedIn — visible after 2026-02-16 15:10 BRT */}
              {Date.now() >= new Date("2026-02-16T15:10:00-03:00").getTime() && (
              <a href="https://linkedin.com/in/darpimen11" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.08] text-text-muted/50 hover:text-[#0A66C2] hover:border-[#0A66C2]/30 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" title="LinkedIn" aria-label="Visit LinkedIn profile">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
              </a>
              )}
              <a href="https://github.com/darpimen11" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.08] text-text-muted/50 hover:text-text hover:border-white/20 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" title="GitHub" aria-label="View GitHub profile">
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
              </a>
            </div>
          </div>
        </div>
      </footer>

      <Suspense fallback={null}>
        <ApiKeyModal 
          isOpen={showApiKeyModal}
          onClose={() => setShowApiKeyModal(false)}
          onSuccess={() => setHasUserKey(true)}
        />
      </Suspense>
      <ToastContainer position="bottom-right" theme="dark" />
      <SpeedInsights />
    </div>
  );
}

function App() {
  const shareMatch = window.location.pathname.match(/^\/share\/([^/?#]+)/);
  if (shareMatch) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-bg" />}>
        <SharedAnalysis shareId={shareMatch[1]} />
      </Suspense>
    );
  }
  return <AppMain />;
}

export default App
