export class CaptionExtractor {
  static getTranscript(): string {
    const captionSegments = document.querySelectorAll('.ytp-caption-segment');
    if (!captionSegments.length) return "";

    const text = Array.from(captionSegments)
      .map(segment => segment.textContent?.trim())
      .filter(Boolean)
      .join(" ");
    console.log("Transcript extracted:", text);
    return text;
  }

  static observeCaptions(callback: (text: string) => void): MutationObserver {
    const observer = new MutationObserver(() => {
      const text = this.getTranscript();
      if (text) callback(text);
    });

    // We observe the body or a specific player container
    // To be safe and minimal, we observe the whole document for caption segment additions
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    return observer;
  }
}
