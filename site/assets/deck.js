(() => {
  const deck = document.querySelector(".feature-deck");
  if (!deck || typeof window.Swiper !== "function") return;

  const tabs = [...deck.querySelectorAll(".deck-tab")];
  const toggle = deck.querySelector(".deck-play");
  const progress = deck.querySelector(".deck-progress span");
  const status = deck.querySelector('[role="status"]');
  const motion = matchMedia("(prefers-reduced-motion: reduce)");

  function syncVideo(swiper) {
    swiper.slides.forEach((slide, i) => {
      const active = i === swiper.activeIndex;
      const video = slide.querySelector("video");
      slide.inert = !active;
      if (active) slide.removeAttribute("aria-hidden");
      else slide.setAttribute("aria-hidden", "true");
      tabs[i].setAttribute("aria-pressed", String(active));
      if (!active || !swiper.autoplay.running || swiper.autoplay.paused || document.hidden) {
        video.pause();
      } else {
        if (!video.hasAttribute("src")) video.src = video.dataset.src;
        void video.play().catch(() => {}); // The poster remains if playback is blocked.
      }
    });
  }

  function updateToggle(swiper) {
    const playing = swiper.autoplay.running;
    const label = playing ? "Pause autoplay" : "Start autoplay";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    toggle.dataset.playing = String(playing);
    syncVideo(swiper);
  }

  const swiper = new window.Swiper(deck.querySelector(".swiper"), {
    effect: "cards",
    cardsEffect: { perSlideOffset: 9, perSlideRotate: 3, slideShadows: false },
    rewind: true,
    speed: motion.matches ? 0 : 440,
    autoplay: { enabled: !motion.matches, disableOnInteraction: false, pauseOnMouseEnter: false },
    on: {
      slideChange(instance) {
        const video = instance.slides[instance.activeIndex].querySelector("video");
        if (video.readyState) video.currentTime = 0;
        progress.style.transform = "scaleX(0)";
        syncVideo(instance);
      },
      autoplayTimeLeft(_instance, _time, remaining) {
        if (Number.isFinite(remaining)) progress.style.transform = `scaleX(${Math.min(1, Math.max(0, 1 - remaining))})`;
      },
      autoplayStart: updateToggle,
      autoplayStop: updateToggle,
      autoplayPause: syncVideo,
      autoplayResume: syncVideo,
    },
  });

  tabs.forEach((tab, i) => tab.addEventListener("click", () => {
    swiper.slideTo(i);
    status.textContent = swiper.slides[i].querySelector("h3").textContent;
  }));
  toggle.addEventListener("click", () => {
    if (swiper.autoplay.running) swiper.autoplay.stop();
    else {
      const video = swiper.slides[swiper.activeIndex].querySelector("video");
      if (video.readyState) video.currentTime = 0;
      swiper.autoplay.start();
    }
  });
  deck.addEventListener("focusin", (event) => {
    if (event.target.matches(".deck-tab:focus-visible") && swiper.autoplay.running) swiper.autoplay.stop();
  });
  document.addEventListener("visibilitychange", () => syncVideo(swiper));
  motion.addEventListener("change", () => {
    swiper.params.speed = motion.matches ? 0 : 440;
    if (motion.matches) swiper.autoplay.stop();
  });
  deck.querySelector(".deck-controls").hidden = false;
  updateToggle(swiper);
})();
