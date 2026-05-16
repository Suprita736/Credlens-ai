export type CredibilityLevel = 'low' | 'medium' | 'high' | 'none';

export interface ClaimAnalysis {
  containsClaim: boolean;
  claim?: string;
  category?: string;
  isSatire: boolean;
  reasoning?: string;
  credibility?: CredibilityLevel;
}

export interface VideoState {
  videoId: string;
  viewTime: number;
  processed: boolean;
  analysis?: ClaimAnalysis;
}

export interface Settings {
  geminiApiKey: string;
}
