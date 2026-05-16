import React from 'react';
import type { ClaimAnalysis } from '../types';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

interface Props {
  analysis: ClaimAnalysis;
  onClose: () => void;
}

const CredibilityOverlay: React.FC<Props> = ({ analysis, onClose }) => {
  if (analysis.isSatire) return null;

  const getStatusConfig = () => {
    if (!analysis.containsClaim) {
      return {
        color: 'bg-green-500',
        icon: <CheckCircle2 size={18} className="text-white" />,
        text: 'No issues found',
        level: 'high'
      };
    }

    // In a real app, we'd check if the claim is verified.
    // For Phase 1, we show Yellow if a claim is detected.
    return {
      color: 'bg-yellow-500',
      icon: <AlertTriangle size={18} className="text-white" />,
      text: 'Unverified Claim',
      level: 'medium'
    };
  };

  const config = getStatusConfig();

  return (
    <div className={`
      flex items-center gap-3 p-3 rounded-xl shadow-2xl backdrop-blur-md 
      transition-all duration-500 animate-in fade-in slide-in-from-top-4
      ${config.color} bg-opacity-90 text-white min-w-[200px] border border-white border-opacity-20
    `}>
      <div className="flex-shrink-0">
        {config.icon}
      </div>
      
      <div className="flex-grow">
        <p className="text-xs font-bold uppercase tracking-wider opacity-80">
          CredLens AI
        </p>
        <p className="text-sm font-medium leading-tight">
          {config.text}
        </p>
        {analysis.claim && (
          <p className="text-[10px] mt-1 opacity-90 line-clamp-2 italic">
            "{analysis.claim}"
          </p>
        )}
      </div>

      <button 
        onClick={onClose}
        className="flex-shrink-0 hover:bg-black hover:bg-opacity-10 p-1 rounded-full transition-colors"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default CredibilityOverlay;
