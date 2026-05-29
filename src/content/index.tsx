import { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { CaptionExtractor } from "../utils/captionExtractor.ts";
import {
  preFilterTranscript,
  deduplicateTranscript,
} from "../utils/transcriptFilter.ts";
import type { VideoState, BackgroundResponse } from "../types";
import CredibilityOverlay from "../components/CredibilityOverlay.tsx";
import { Loader2, AlertCircle, X } from "lucide-react";
import "../index.css";

const YouTubeShortsDetector = () => {
  const [activeVideo, setActiveVideo] = useState<VideoState | null>(null);
  const swipeLockRef = useRef(true); // true = still in 3-s swipe cooldown
  const transcriptRef = useRef("");
  const seenSegmentsRef = useRef(new Set<string>()); // dedup individual caption segments
  const analysisTriggered = useRef(false);
  const debounceTimerRef = useRef<any>(null); // debounce rapid caption bursts
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const watchStartRef = useRef<number>(0);
  const processedVideoRef = useRef<string | null>(null);
  const reconnectingRef = useRef(false);
  // 1. Establish long-lived Port connection with Background Service Worker
  useEffect(() => {
    const connectPort = () => {
      console.log("[Content] Connecting to CredLens background port...");
      const port = chrome.runtime.connect({ name: "credlens-verification" });
      portRef.current = port;

      port.onMessage.addListener((message: BackgroundResponse) => {
        const { status, videoId, analysis, error } = message;
        console.log(
          `[Content] Port Message: ${status} for video ${videoId}`,
          message,
        );

        setActiveVideo((prev) => {
          if (!prev || prev.videoId !== videoId) return prev;

          return {
            ...prev,
            status,
            processed: status === "completed",
            analysis: status === "completed" ? analysis : prev.analysis,
          };
        });

        if (status === "error" && error) {
          console.warn("[Content] Background pipeline reported error:", error);
        }
      });

      port.onDisconnect.addListener(() => {
        console.warn("[Content] Background port disconnected.");

        portRef.current = null;

        if (reconnectingRef.current) return;

        reconnectingRef.current = true;

        setTimeout(() => {
          console.log("[Content] Reconnecting background port...");

          connectPort();

          reconnectingRef.current = false;
        }, 3000);
      });
    };

    connectPort();

    return () => {
      if (portRef.current) {
        portRef.current.disconnect();
      }
    };
  }, []);

  // 2. Detect YouTube Shorts URL navigation (YouTube uses SPA navigation)
  useEffect(() => {
    const handleUrlChange = () => {
      const url = window.location.href;
      if (url.includes("/shorts/")) {
        const videoId = url.split("/shorts/")[1].split("?")[0];
        console.log("[Content] Detected Shorts video:", videoId);

        if (activeVideo?.videoId !== videoId) {
          resetAndStartNewVideo(videoId);
        }
      } else {
        setActiveVideo(null);
      }
    };

    window.addEventListener("yt-navigate-finish", handleUrlChange);
    handleUrlChange(); // Initial check

    return () => {
      window.removeEventListener("yt-navigate-finish", handleUrlChange);
    };
  }, [activeVideo]);

  const resetAndStartNewVideo = (videoId: string) => {
    // Set watch time starting point
    watchStartRef.current = Date.now();

    // Cancel any pending debounce
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    // Notify background worker to abort active fetches for old video
    if (activeVideo?.videoId && portRef.current) {
      console.log(
        `[Content] Swiped away from ${activeVideo.videoId}. Requesting cancellation.`,
      );
      try {
        portRef.current.postMessage({
          action: "CANCEL_VERIFICATION",
          videoId: activeVideo.videoId,
        });
      } catch (err) {
        console.warn("[Content] Port failed to send cancel message:", err);
      }
    }

    // Reset all per-video state
    transcriptRef.current = "";
    seenSegmentsRef.current.clear();
    analysisTriggered.current = false;
    swipeLockRef.current = true; // engage swipe lock
    CaptionExtractor.reset();
    processedVideoRef.current = null;
    setActiveVideo({
      videoId,
      viewTime: 0,
      processed: false,
    });

    console.log(`[Content] Swipe lock started for: ${videoId}`);
    // Release swipe lock after 3 s — only then do we start collecting captions
    setTimeout(() => {
      swipeLockRef.current = false;
      console.log("[Content] Swipe lock released. Ready for captions.");
    }, 3000);
  };

  // shouldIgnoreTranscript and cleanTranscript are now handled by
  // preFilterTranscript() and deduplicateTranscript() from transcriptFilter.ts

  // Send cleaned, pre-filtered transcript to Background Service Worker
  const triggerBackgroundVerification = (videoId: string) => {
    // Deduplicate the raw buffer (fixes progressive caption double-append)
    const deduped = deduplicateTranscript(transcriptRef.current);
    if (processedVideoRef.current === videoId) {
      console.log("[Content] Video already analyzed.");
      return;
    }
    // Lightweight pre-filter — zero API cost
    const filterResult = preFilterTranscript(deduped);
    if (!filterResult.pass) {
      console.log(
        `[Content] Pre-filter blocked transcript: ${filterResult.reason}`,
      );
      analysisTriggered.current = false;
      return;
    }

    if (!portRef.current) {
      console.warn("[Content] Port not established.");
      analysisTriggered.current = false;
      return;
    }

    console.log(
      `[Content] Sending to background (${deduped.split(/\s+/).length} words): "${deduped.substring(0, 90)}…"`,
    );

    try {
      portRef.current.postMessage({
        action: "VERIFY_TRANSCRIPT",
        videoId,
        transcript: deduped,
      });
      processedVideoRef.current = videoId;
    } catch (err) {
      console.error("[Content] Port error sending verification request:", err);
      analysisTriggered.current = false;
    }
  };

  // 3. Capture and stabilize transcripts from MutationObserver
  useEffect(() => {
    const observer = CaptionExtractor.observeCaptions((text) => {
      if (!text || !activeVideo) return;

      // Ignore captions during swipe lock period
      if (swipeLockRef.current) return;

      // Deduplicate individual incoming segments
      const normalised = text.trim();
      if (!normalised || seenSegmentsRef.current.has(normalised)) return;
      seenSegmentsRef.current.add(normalised);
      transcriptRef.current += " " + normalised;

      // Trigger verification once transcript reaches 40 words, with watch-time gate & debounce
      const wordCount = transcriptRef.current.split(/\s+/).length;
      const elapsedWatchTime = Date.now() - watchStartRef.current;
      if (
        !analysisTriggered.current &&
        !activeVideo.processed &&
        wordCount >= 40 &&
        elapsedWatchTime >= 3000
      ) {
        analysisTriggered.current = true;

        // Debounce: wait 2.0 s for caption stream to settle before firing
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
          console.log(
            `[Content] Transcript stabilized with ${transcriptRef.current.split(/\s+/).length} words.`,
          );
          triggerBackgroundVerification(activeVideo.videoId);
          debounceTimerRef.current = null;
        }, 2000);
      }
    });

    return () => observer.disconnect();
  }, [activeVideo]);

  if (!activeVideo) return null;

  // Render elegant loading/error states in the Shadow DOM overlay
  const renderStatusView = () => {
    if (activeVideo.status === "loading") {
      return (
        <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-full bg-slate-950/85 backdrop-blur-lg border border-slate-800/80 shadow-lg text-slate-300 animate-pulse text-xs select-none">
          <Loader2 size={14} className="animate-spin text-blue-400" />
          <span className="font-semibold uppercase tracking-wider">
            CredLens: Analyzing...
          </span>
        </div>
      );
    }

    if (activeVideo.status === "error") {
      return (
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-full bg-rose-950/85 backdrop-blur-lg border border-rose-800/50 shadow-lg text-rose-200 text-xs select-none">
          <AlertCircle size={14} className="text-rose-400 shrink-0" />
          <div className="flex flex-col">
            <span className="font-bold uppercase tracking-wider text-[8px] opacity-75 leading-none">
              CredLens Error
            </span>
            <span className="font-medium mt-0.5 leading-tight">
              Click extension to setup Key
            </span>
          </div>
          <button
            onClick={() => setActiveVideo(null)}
            className="ml-1 p-0.5 hover:bg-rose-900/50 rounded-full transition-colors"
          >
            <X size={10} />
          </button>
        </div>
      );
    }

    if (activeVideo.status === "completed" && activeVideo.analysis) {
      return (
        <CredibilityOverlay
          analysis={activeVideo.analysis}
          onClose={() => setActiveVideo(null)}
        />
      );
    }

    return null;
  };

  return renderStatusView();
};

// Advanced styling syncer: Sync Vite extension stylesheet rules into isolated Shadow DOM
const syncStylesIntoShadow = (shadowRoot: ShadowRoot) => {
  const syncNode = (node: Node) => {
    if (node.nodeName === "LINK") {
      const link = node as HTMLLinkElement;
      if (
        link.rel === "stylesheet" &&
        link.href.startsWith("chrome-extension://")
      ) {
        const clone = link.cloneNode(true) as HTMLLinkElement;
        shadowRoot.appendChild(clone);
      }
    } else if (node.nodeName === "STYLE") {
      const style = node as HTMLStyleElement;
      const clone = style.cloneNode(true) as HTMLStyleElement;
      shadowRoot.appendChild(clone);
    }
  };

  // Sync existing stylesheets
  document.querySelectorAll("style, link[rel='stylesheet']").forEach(syncNode);

  // Sync dynamic stylesheet injections (e.g. CRXJS hot-reloading/updates)
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeName === "LINK" || node.nodeName === "STYLE") {
          syncNode(node);
        }
      });
    }
  });

  observer.observe(document.head, { childList: true });
  return observer;
};

// Initialize Shadow DOM Container
const init = () => {
  if (document.getElementById("credlens-root")) return;

  console.log("[Content] Initializing CredLens root container...");
  const container = document.createElement("div");
  container.id = "credlens-root";
  document.body.appendChild(container);

  const shadowRoot = container.attachShadow({ mode: "open" });
  const shadowWrapper = document.createElement("div");
  shadowWrapper.id = "credlens-shadow-wrapper";
  shadowRoot.appendChild(shadowWrapper);

  // Inject root host styling
  const style = document.createElement("style");
  style.textContent = `
    #credlens-shadow-wrapper {
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 2147483647; /* Set to absolute max to float over video overlays */
      pointer-events: auto;
    }
  `;
  shadowRoot.appendChild(style);

  // Establish live styling sync from document head to isolated Shadow DOM
  const styleObserver = syncStylesIntoShadow(shadowRoot);

  const root = ReactDOM.createRoot(shadowWrapper);
  root.render(<YouTubeShortsDetector />);

  // Cleanup on page teardown
  window.addEventListener("unload", () => {
    styleObserver.disconnect();
  });
};

// Delay until document is interactive
if (document.body) {
  init();
} else {
  window.addEventListener("DOMContentLoaded", init);
}
