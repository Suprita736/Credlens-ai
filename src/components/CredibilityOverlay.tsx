import React, { useState } from "react";
import type { ClaimAnalysis } from "../types";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  X,
  BookOpen,
  Newspaper,
  Sparkles,
  Info
} from "lucide-react";

interface Props {
  analysis: ClaimAnalysis;
  onClose: () => void;
}

const CredibilityOverlay: React.FC<Props> = ({ analysis, onClose }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (analysis.isSatire) {
    // Elegant small indicator for Satire to not disrupt comedy videos
    return (
      <div className="flex items-center gap-2 p-2 bg-indigo-950/80 backdrop-blur-md border border-indigo-800/50 rounded-xl shadow-lg text-indigo-200 select-none animate-in fade-in slide-in-from-top-2 text-xs">
        <Sparkles size={14} className="animate-pulse text-indigo-400" />
        <span className="font-semibold uppercase tracking-wider">Satirical Content</span>
        <button
          onClick={onClose}
          className="ml-2 p-0.5 hover:bg-indigo-900/50 rounded-full transition-colors"
        >
          <X size={10} />
        </button>
      </div>
    );
  }

  // Get dynamic styles based on credibility level
  const getCredibilityConfig = () => {
    switch (analysis.credibility) {
      case "high":
        return {
          glow: "shadow-[0_0_15px_rgba(16,185,129,0.2)]",
          border: "border-emerald-500/30 hover:border-emerald-500/50",
          bg: "bg-emerald-950/85",
          pillBg: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
          text: "text-emerald-300",
          icon: <ShieldCheck className="text-emerald-400 shrink-0" size={18} />,
          gradient: "from-emerald-500 to-teal-400",
          badgeText: "High Credibility"
        };
      case "medium":
        return {
          glow: "shadow-[0_0_15px_rgba(245,158,11,0.2)]",
          border: "border-amber-500/30 hover:border-amber-500/50",
          bg: "bg-amber-950/85",
          pillBg: "bg-amber-500/20 text-amber-300 border-amber-500/40",
          text: "text-amber-300",
          icon: <ShieldAlert className="text-amber-400 shrink-0" size={18} />,
          gradient: "from-amber-500 to-orange-400",
          badgeText: "Unverified / Mixed"
        };
      case "low":
        return {
          glow: "shadow-[0_0_15px_rgba(239,68,68,0.25)]",
          border: "border-rose-500/30 hover:border-rose-500/50",
          bg: "bg-rose-950/85",
          pillBg: "bg-rose-500/20 text-rose-300 border-rose-500/40",
          text: "text-rose-300",
          icon: <ShieldAlert className="text-rose-400 shrink-0" size={18} />,
          gradient: "from-rose-500 to-red-400",
          badgeText: "Inaccurate Claims"
        };
      default:
        return {
          glow: "shadow-[0_0_15px_rgba(148,163,184,0.15)]",
          border: "border-slate-700/50 hover:border-slate-600/70",
          bg: "bg-slate-900/85",
          pillBg: "bg-slate-800 text-slate-300 border-slate-700",
          text: "text-slate-300",
          icon: <Shield className="text-slate-400 shrink-0" size={18} />,
          gradient: "from-slate-500 to-slate-400",
          badgeText: "Unverified Claim"
        };
    }
  };

  const config = getCredibilityConfig();
  const hasSources =
    (analysis.factCheck?.url) ||
    (analysis.healthResearch?.sources && analysis.healthResearch.sources.length > 0) ||
    (analysis.newsVerification?.sources && analysis.newsVerification.sources.length > 0);

  return (
    <div className="font-sans antialiased select-none pointer-events-auto">
      {!isExpanded ? (
        // COMPACT Badged Pill View (Minimalist, Non-intrusive)
        <div
          onClick={() => setIsExpanded(true)}
          className={`
            flex items-center gap-2.5 px-3.5 py-2.5 rounded-full backdrop-blur-lg border transition-all duration-300 cursor-pointer
            ${config.bg} ${config.border} ${config.glow} text-white hover:scale-105 active:scale-95 animate-in fade-in slide-in-from-top-4
          `}
        >
          {config.icon}
          <div className="flex flex-col pr-1">
            <span className="text-[9px] uppercase tracking-widest text-slate-400 font-bold leading-none">
              CredLens AI
            </span>
            <span className="text-xs font-semibold leading-tight mt-0.5">
              {analysis.verdict || "Unverified Claim"}
            </span>
          </div>
          <ChevronDown size={14} className="text-slate-400 hover:text-white transition-colors ml-1 shrink-0" />
        </div>
      ) : (
        // EXPANDED Dashboard View (Premium Glassmorphic Panel)
        <div
          className={`
            w-96 p-5 rounded-2xl backdrop-blur-xl border border-slate-800/80 bg-slate-950/90 text-white shadow-2xl 
            transition-all duration-300 animate-in fade-in zoom-in-95 ${config.glow}
          `}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-900 pb-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-slate-900 rounded-lg">
                {config.icon}
              </div>
              <div>
                <h3 className="text-sm font-bold tracking-tight">CredLens Fact Check</h3>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mt-0.5">
                  AI Misinformation Shield
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-1">
              {analysis.category && (
                <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-400 font-semibold uppercase tracking-wider">
                  {analysis.category}
                </span>
              )}
              <button
                onClick={onClose}
                className="p-1 hover:bg-slate-900 rounded-full transition-colors text-slate-400 hover:text-white"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Factual Claim Detected */}
          {analysis.claim && (
            <div className="mb-4 bg-slate-900/50 border border-slate-900 p-3 rounded-xl">
              <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500">
                Detected Statement
              </span>
              <p className="text-xs text-slate-300 mt-1 italic font-medium leading-relaxed">
                "{analysis.claim}"
              </p>
            </div>
          )}

          {/* Credibility & Verdict Meter */}
          <div className="flex gap-4 mb-4 items-center bg-slate-900/20 p-3 rounded-xl border border-slate-900">
            {/* Circular Progress Gauge */}
            <div className="relative flex items-center justify-center shrink-0">
              <svg className="w-14 h-14 transform -rotate-90">
                <circle
                  cx="28"
                  cy="28"
                  r="23"
                  className="stroke-slate-800"
                  strokeWidth="4"
                  fill="transparent"
                />
                <circle
                  cx="28"
                  cy="28"
                  r="23"
                  className="stroke-current transition-all duration-1000 ease-out"
                  strokeWidth="4"
                  fill="transparent"
                  strokeDasharray={144.5}
                  strokeDashoffset={144.5 - (144.5 * (analysis.confidence || 50)) / 100}
                  strokeLinecap="round"
                  style={{
                    color: analysis.credibility === "high" ? "#10b981" : analysis.credibility === "medium" ? "#f59e0b" : "#f43f5e"
                  }}
                />
              </svg>
              <span className="absolute text-[11px] font-bold">
                {analysis.confidence || 50}%
              </span>
            </div>

            <div className="flex-grow">
              <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500 leading-none">
                AI Rating Verdict
              </span>
              <div className="flex items-center gap-2 mt-1">
                <span className={`text-xs font-bold ${config.text}`}>
                  {analysis.verdict || "Unverified"}
                </span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold border uppercase tracking-wider leading-none ${config.pillBg}`}>
                  {config.badgeText}
                </span>
              </div>
            </div>
          </div>

          {/* Confidence Breakdown Metrics */}
          {(!analysis.isSatire && (analysis.scientificSupport || analysis.manipulationRisk || analysis.evidenceStrength)) && (
            <div className="flex items-center justify-between gap-1.5 mb-4 p-2.5 rounded-xl bg-slate-900/40 border border-slate-900">
              {analysis.scientificSupport && analysis.scientificSupport !== "N/A" && (
                <div className="flex-1 flex flex-col items-center border-r border-slate-900/80 last:border-0">
                  <span className="text-[8px] uppercase tracking-wider text-slate-500 font-bold leading-none">Science</span>
                  <span className={`text-[10px] font-extrabold mt-1 leading-none ${
                    analysis.scientificSupport === "Strong" ? "text-emerald-400" :
                    analysis.scientificSupport === "Moderate" ? "text-amber-400" : "text-rose-400"
                  }`}>
                    {analysis.scientificSupport}
                  </span>
                </div>
              )}
              {analysis.evidenceStrength && (
                <div className="flex-1 flex flex-col items-center border-r border-slate-900/80 last:border-0">
                  <span className="text-[8px] uppercase tracking-wider text-slate-500 font-bold leading-none">Evidence</span>
                  <span className={`text-[10px] font-extrabold mt-1 leading-none ${
                    analysis.evidenceStrength === "Strong" ? "text-emerald-400" :
                    analysis.evidenceStrength === "Moderate" ? "text-amber-400" : "text-rose-400"
                  }`}>
                    {analysis.evidenceStrength}
                  </span>
                </div>
              )}
              {analysis.manipulationRisk && (
                <div className="flex-1 flex flex-col items-center border-r border-slate-900/80 last:border-0">
                  <span className="text-[8px] uppercase tracking-wider text-slate-500 font-bold leading-none">Manip. Risk</span>
                  <span className={`text-[10px] font-extrabold mt-1 leading-none ${
                    analysis.manipulationRisk === "Low" ? "text-emerald-400" :
                    analysis.manipulationRisk === "Moderate" ? "text-amber-400" : "text-rose-400"
                  }`}>
                    {analysis.manipulationRisk}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Soft Correction Explanation */}
          <div className="mb-4 space-y-2">
            <div>
              <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500">
                Evidence Summary
              </span>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                {analysis.explanation || "No supporting external reports could be found to verify this statement."}
              </p>
            </div>

            {analysis.alternativeExplanation && (
              <div className="pt-1.5 border-t border-slate-900">
                <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500">
                  Safer Context
                </span>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  {analysis.alternativeExplanation}
                </p>
              </div>
            )}
          </div>

          {/* Outbound Citations & Evidence Sources */}
          {hasSources && (
            <div className="mt-4 border-t border-slate-900 pt-3">
              <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500 flex items-center gap-1">
                <BookOpen size={10} />
                External Supporting Evidence
              </span>
              
              <div className="mt-2 space-y-2 max-h-36 overflow-y-auto pr-1 scrollbar-thin">
                {/* 1. Fact-Check Citations */}
                {analysis.factCheck?.url && (
                  <a
                    href={analysis.factCheck.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 p-2 bg-slate-900/50 hover:bg-slate-900 rounded-lg border border-slate-900 transition-colors text-slate-300 hover:text-white"
                  >
                    <Info size={14} className="text-indigo-400 shrink-0 mt-0.5" />
                    <div className="flex-grow min-w-0">
                      <p className="text-[10px] font-semibold truncate">
                        {analysis.factCheck.explanation}
                      </p>
                      <p className="text-[8px] text-slate-500 mt-0.5 flex items-center gap-1">
                        <span>Database Review by {analysis.factCheck.source}</span>
                        <ExternalLink size={8} />
                      </p>
                    </div>
                  </a>
                )}

                {/* 2. Medical Research Citations */}
                {analysis.healthResearch?.sources &&
                  analysis.healthResearch.sources.map((art, idx) => (
                    <a
                      key={`health-${idx}`}
                      href={art.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2 p-2 bg-slate-900/50 hover:bg-slate-900 rounded-lg border border-slate-900 transition-colors text-slate-300 hover:text-white"
                    >
                      <BookOpen size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                      <div className="flex-grow min-w-0">
                        <p className="text-[10px] font-semibold truncate">
                          {art.title.replace(/\.$/, "")}
                        </p>
                        <p className="text-[8px] text-slate-500 mt-0.5 flex items-center gap-1">
                          <span>{art.journal} ({art.date.split(" ")[0]})</span>
                          <ExternalLink size={8} />
                        </p>
                      </div>
                    </a>
                  ))}

                {/* 3. News Grounding Citations */}
                {analysis.newsVerification?.sources &&
                  analysis.newsVerification.sources.map((art, idx) => (
                    <a
                      key={`news-${idx}`}
                      href={art.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2 p-2 bg-slate-900/50 hover:bg-slate-900 rounded-lg border border-slate-900 transition-colors text-slate-300 hover:text-white"
                    >
                      <Newspaper size={14} className="text-blue-400 shrink-0 mt-0.5" />
                      <div className="flex-grow min-w-0">
                        <p className="text-[10px] font-semibold truncate text-left">
                          {art.title}
                        </p>
                        <p className="text-[8px] text-slate-500 mt-0.5 flex items-center gap-1">
                          <span>{art.source}</span>
                          <ExternalLink size={8} />
                        </p>
                      </div>
                    </a>
                  ))}
              </div>
            </div>
          )}

          {/* Footer Action */}
          <div className="mt-4 border-t border-slate-900 pt-3 flex items-center justify-between text-[9px] text-slate-500 font-medium">
            <span>Verified at {new Date().toLocaleDateString()}</span>
            <button
              onClick={() => setIsExpanded(false)}
              className="text-slate-400 hover:text-white flex items-center gap-0.5 py-0.5 px-1.5 hover:bg-slate-900 rounded transition-colors"
            >
              <span>Collapse Panel</span>
              <ChevronUp size={10} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CredibilityOverlay;
