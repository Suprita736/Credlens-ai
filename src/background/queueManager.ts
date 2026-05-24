/**
 * Request Queue and Cancellation Manager
 * Manages active verification requests by videoId, offering AbortController triggers
 * to cancel outstanding network fetches when a user swipes away or navigates.
 */
export class QueueManager {
  private static activeRequests = new Map<string, AbortController>();

  /**
   * Registers a new request for a video.
   * If a previous request is still running, it is cancelled automatically.
   */
  static register(videoId: string): AbortSignal {
    this.cancel(videoId); // Cancel any existing active request for this video

    const controller = new AbortController();
    this.activeRequests.set(videoId, controller);
    console.log(`[QueueManager] Registered new request for video: ${videoId}`);
    return controller.signal;
  }

  /**
   * Cancels any active verification requests for the specified video.
   */
  static cancel(videoId: string): void {
    const controller = this.activeRequests.get(videoId);
    if (controller) {
      console.log(`[QueueManager] Cancelling active request for video: ${videoId}`);
      controller.abort();
      this.activeRequests.delete(videoId);
    }
  }

  /**
   * Removes a video from active tracking once its processing is complete.
   */
  static complete(videoId: string): void {
    if (this.activeRequests.has(videoId)) {
      console.log(`[QueueManager] Request completed for video: ${videoId}`);
      this.activeRequests.delete(videoId);
    }
  }

  /**
   * Cancels all active requests (e.g., if extension is suspended).
   */
  static cancelAll(): void {
    console.log(`[QueueManager] Cancelling all active requests`);
    for (const controller of this.activeRequests.values()) {
      controller.abort();
    }
    this.activeRequests.clear();
  }
}
