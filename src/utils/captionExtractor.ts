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


    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    return observer;
  }
}
