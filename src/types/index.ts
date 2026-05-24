export type CredibilityLevel = 'low' | 'medium' | 'high' | 'none';

export interface FactCheckReview {
  publisher: string;
  url: string;
  title: string;
  verdict: string;
  date?: string;
}

export interface FactCheckResult {
  verified: boolean;
  verdict: string;
  source: string;
  explanation: string;
  url: string;
  confidence: number;
}

export interface ResearchArticle {
  title: string;
  journal: string;
  authors: string;
  date: string;
  url: string;
  id: string;
}

export interface HealthVerificationResult {
  status: 'Scientifically supported' | 'Limited evidence' | 'No credible evidence found' | 'Contradictory evidence exists';
  summary: string;
  sources: ResearchArticle[];
}

export interface NewsArticle {
  title: string;
  source: string;
  url: string;
  date: string;
}

export interface NewsVerificationResult {
  status: 'Widely reported' | 'Partially verified' | 'No trusted reporting found' | 'Conflicting reports';
  summary: string;
  sources: NewsArticle[];
}

export interface ClaimAnalysis {
  containsClaim: boolean;
  claim?: string;
  category?: 'health' | 'science' | 'politics' | 'finance' | 'news' | 'other' | null;
  isSatire: boolean;
  reasoning?: string;
  
  // Verification Results
  verdict?: string; // e.g., "Mostly False", "Partially verified", "Scientifically supported"
  credibility?: CredibilityLevel;
  confidence?: number;
  explanation?: string; // soft correction summary
  alternativeExplanation?: string;
  sourceName?: string;
  sourceUrl?: string;
  
  // Rich evidence sub-blocks
  factCheck?: FactCheckResult | null;
  healthResearch?: HealthVerificationResult | null;
  newsVerification?: NewsVerificationResult | null;
}

export interface VideoState {
  videoId: string;
  viewTime: number;
  processed: boolean;
  status?: 'loading' | 'completed' | 'error';
  analysis?: ClaimAnalysis;
}

export interface Settings {
  geminiApiKey: string;
}

export interface BackgroundMessage {
  action: 'VERIFY_TRANSCRIPT' | 'CANCEL_VERIFICATION';
  videoId?: string;
  transcript?: string;
}

export interface BackgroundResponse {
  status: 'loading' | 'completed' | 'error';
  videoId: string;
  analysis?: ClaimAnalysis;
  error?: string;
}
