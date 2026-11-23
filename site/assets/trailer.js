(() => {
  const video = document.querySelector("#trailer-video");
  if (!video || !("IntersectionObserver" in window)) return;

  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting || entry.intersectionRatio < 0.5 || motion.matches) return;
    observer.disconnect();
    void video.play().catch(() => {}); // Native controls still work if autoplay is blocked.
  }, { threshold: 0.5 });

  // Manual playback also consumes the one-shot autoplay, so scrolling never overrides a pause.
  video.addEventListener("play", () => observer.disconnect(), { once: true });
  observer.observe(video);
})();
