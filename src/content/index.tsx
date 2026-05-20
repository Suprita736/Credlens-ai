import { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { GeminiService } from "../services/geminiService.ts";
import { CaptionExtractor } from "../utils/captionExtractor.ts";
import type { VideoState } from "../types";
import CredibilityOverlay from "../components/CredibilityOverlay.tsx";
import "../index.css";

const YouTubeShortsDetector = () => {
  const [activeVideo, setActiveVideo] = useState<VideoState | null>(null);
  const viewTimerRef = useRef<any>(null);
  const transcriptRef = useRef("");
  const stabilizationTimerRef = useRef<any>(null);
  const lastTranscriptRef = useRef("");
  const analysisInProgress = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const handleUrlChange = () => {
      console.log("URL changed:", window.location.href);
      const url = window.location.href;
      if (url.includes("/shorts/")) {
        const videoId = url.split("/shorts/")[1].split("?")[0];
        console.log("Detected Shorts video:", videoId);
        transcriptRef.current = "";
        analysisInProgress.current = false;
        if (activeVideo?.videoId !== videoId) {
          resetAndStartNewVideo(videoId);
        }
      } else {
        setActiveVideo(null);
      }
    };

    // Listen for navigation changes (YouTube uses SPA navigation)
    window.addEventListener("yt-navigate-finish", handleUrlChange);
    handleUrlChange(); // Initial check

    return () => {
      window.removeEventListener("yt-navigate-finish", handleUrlChange);
    };
  }, [activeVideo]);

  const resetAndStartNewVideo = (videoId: string) => {
    // Clear previous state
    if (viewTimerRef.current) {
      console.log("Previous analysis cancelled due to swipe");
      clearTimeout(viewTimerRef.current);
    }

    if (abortControllerRef.current) {
      console.log("Aborting active Gemini request...");
      abortControllerRef.current.abort();
    }
    transcriptRef.current = "";
    analysisInProgress.current = false;

    setActiveVideo({
      videoId,
      viewTime: 0,
      processed: false,
    });
    console.log("Starting 3-second timer for:", videoId);
    // STEP 3: Swipe Ignore System (3s)
    viewTimerRef.current = setTimeout(() => {
      console.log(
        "User stayed long enough. Waiting for transcript stabilization...",
      );
    }, 3000);
  };

  const shouldIgnoreTranscript = (text: string): boolean => {
    if (!text) return true;

    const cleaned = text.toLowerCase().trim();

    const musicPatterns = [
      "[music]",
      "[musique]",
      "[musik]",
      "[música]",
      "[संगीत]",
      "[సంగీతం]",
      "[음악]",
      "[музыка]",
      "[音楽]",
      "[音乐]",
    ];

    if (
      musicPatterns.some((pattern) =>
        cleaned.includes(pattern.toLowerCase()),
      ) ||
      cleaned.includes("♪") ||
      cleaned.includes("♫")
    ) {
      return true;
    }

    // Ignore repetitive words
    const words = cleaned.split(/\s+/);
    const uniqueWords = new Set(words);

    if (uniqueWords.size <= 3 && words.length > 5) {
      return true;
    }

    return false;
  };

  const cleanTranscript = (text: string): string => {
    if (!text) return "";

    let cleaned = text;

    // Remove music tags
    cleaned = cleaned.replace(/\[music\]/gi, "");

    // Remove anything inside brackets
    cleaned = cleaned.replace(/\[.*?\]/g, "");

    // Remove subtitle arrows
    cleaned = cleaned.replace(/>>/g, "");

    // Remove repeated spaces
    cleaned = cleaned.replace(/\s+/g, " ").trim();

    // Remove repeated words
    cleaned = cleaned.replace(/\b(\w+)( \1\b)+/gi, "$1");

    // Remove duplicate sentence fragments
    const parts = cleaned.split(". ");
    const uniqueParts: string[] = [];

    for (const part of parts) {
      if (!uniqueParts.includes(part.trim())) {
        uniqueParts.push(part.trim());
      }
    }

    cleaned = uniqueParts.join(". ");

    return cleaned.trim();
  };

  const startAnalysis = async (videoId: string) => {
    if (analysisInProgress.current) return;

    const finalTranscript = cleanTranscript(transcriptRef.current);

    if (!finalTranscript || finalTranscript.length < 10) {
      console.log("Transcript too short after stabilization");
      return;
    }

    console.log("Final stabilized transcript:", finalTranscript);

    if (shouldIgnoreTranscript(finalTranscript)) {
      console.log("Ignoring low-information transcript");
      return;
    }

    analysisInProgress.current = true;

    console.log("Starting AI analysis...");

    const settings = (await chrome.storage.local.get(["geminiApiKey"])) as {
      geminiApiKey?: string;
    };

    console.log("Stored Gemini Key:", settings.geminiApiKey);

    if (!settings.geminiApiKey) {
      console.warn("Gemini API key not found");
      return;
    }

    abortControllerRef.current = new AbortController();

    const gemini = new GeminiService(settings.geminiApiKey);

    const result = await gemini.analyzeTranscript(
      finalTranscript,
      abortControllerRef.current.signal,
    );

    setActiveVideo((prev) =>
      prev && prev.videoId === videoId
        ? {
            ...prev,
            processed: true,
            analysis: result,
          }
        : prev,
    );
  };

  useEffect(() => {
    // Start observing captions
    const observer = CaptionExtractor.observeCaptions((text) => {
      if (!text) {
        return;
      }

      if (!transcriptRef.current.includes(text)) {
        transcriptRef.current += " " + text;
      }

      // if (shouldIgnoreTranscript(text)) {
      //   console.log("Ignoring music or low-information content early");
      //   return;
      // }

      if (
        !analysisInProgress.current &&
        transcriptRef.current.split(" ").length > 80
      ) {
        analysisInProgress.current = true;

        console.log("Transcript stabilized");
        console.log("Starting AI analysis...");

        if (activeVideo?.videoId) {
          startAnalysis(activeVideo.videoId);
        }
      }
    });

    return () => observer.disconnect();
  }, [activeVideo]);

  if (!activeVideo || !activeVideo.analysis) return null;
  console.log("Rendering overlay:", activeVideo.analysis);

  return (
    <CredibilityOverlay
      analysis={activeVideo.analysis}
      onClose={() => setActiveVideo(null)}
    />
  );
};

// Initialize Shadow DOM
const init = () => {
  console.log("CredLens extension injected");
  const container = document.createElement("div");
  container.id = "credlens-root";
  document.body.appendChild(container);

  const shadowRoot = container.attachShadow({ mode: "open" });
  const shadowWrapper = document.createElement("div");
  shadowWrapper.id = "credlens-shadow-wrapper";
  shadowRoot.appendChild(shadowWrapper);

  // Inject styles into shadow DOM
  const style = document.createElement("style");
  // We'll need to fetch the injected CSS or use a small subset
  // For now, let's use a basic style injection
  style.textContent = `
    #credlens-shadow-wrapper {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 999999;
      pointer-events: auto;
    }
  `;
  shadowRoot.appendChild(style);

  // Create React root
  const root = ReactDOM.createRoot(shadowWrapper);
  root.render(<YouTubeShortsDetector />);
};

// Wait for body to be ready
if (document.body) {
  init();
} else {
  window.addEventListener("DOMContentLoaded", init);
}
