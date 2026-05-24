export class CaptionExtractor {
  private static lastTranscript = "";

  static reset() {
    this.lastTranscript = "";
  }

  static getTranscript(): string {
    const captionSegments = document.querySelectorAll(
      ".ytp-caption-segment"
    );

    if (!captionSegments.length) return "";

    const text = Array.from(captionSegments)
      .map((segment) => segment.textContent?.trim())
      .filter(Boolean)
      .join(" ")
      .trim();

    // Ignore duplicate updates
    if (text === this.lastTranscript) {
      return "";
    }

    this.lastTranscript = text;

    console.log("Transcript extracted:", text);

    return text;
  }

  static observeCaptions(
    callback: (text: string) => void
  ): MutationObserver {
    const observer = new MutationObserver(() => {
      const text = this.getTranscript();

      if (text && text.length > 5) {
        callback(text);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return observer;
  }
}