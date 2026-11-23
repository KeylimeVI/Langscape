(() => {
  const deck = document.querySelector(".feature-deck");
  if (!deck) return;

  const cards = [...deck.querySelectorAll(".deck-card")];
  const tabs = [...deck.querySelectorAll(".deck-tab")];
  const videos = cards.map((card) => card.querySelector("video"));
  const toggle = deck.querySelector(".deck-play");
  const status = deck.querySelector('[role="status"]');
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let active = 0;
  let timer;
  let playback = 0;
  let running = !reduceMotion.matches;
  let hovering = false;

  const canPlay = () => running && !hovering && !document.hidden;
  const advance = () => show((active + 1) % cards.length);

  function schedule(delay) {
    clearTimeout(timer);
    timer = setTimeout(advance, delay);
  }

  function sync() {
    clearTimeout(timer);
    const serial = ++playback;
    const label = running ? "Pause autoplay" : "Start autoplay";
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    toggle.dataset.playing = String(running);
    const video = videos[active];
    if (!canPlay()) {
      video.pause();
      return;
    }
    if (video.ended) {
      schedule(420);
      return;
    }
    if (!video.hasAttribute("src")) video.src = video.dataset.src;
    // Keep the deck usable in browsers that block autoplay or fail to load a clip.
    schedule(14000);
    video.play().then(() => {
      if (serial !== playback) return;
      const remaining = video.duration - video.currentTime;
      if (Number.isFinite(remaining)) schedule(Math.max(0, remaining) * 1000 + 1600);
    }).catch(() => {
      if (serial === playback) schedule(4800);
    });
  }

  function show(index, announce = false) {
    if (index !== active) {
      videos[active].pause();
      active = index;
      if (videos[active].readyState) videos[active].currentTime = 0;
    }
    cards.forEach((card, i) => { card.hidden = i !== active; });
    tabs.forEach((tab, i) => tab.setAttribute("aria-pressed", String(i === active)));
    if (announce) status.textContent = cards[active].querySelector("h3").textContent;
    sync();
  }

  tabs.forEach((tab, i) => tab.addEventListener("click", () => show(i, true)));
  videos.forEach((video, i) => video.addEventListener("ended", () => {
    if (i === active && canPlay()) schedule(420);
  }));
  toggle.addEventListener("click", () => {
    running = !running;
    if (running) hovering = false;
    sync();
  });
  deck.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "mouse") return;
    hovering = true;
    sync();
  });
  deck.addEventListener("pointerleave", () => {
    hovering = false;
    sync();
  });
  deck.addEventListener("focusin", (event) => {
    if (event.target.matches(":focus-visible")) {
      running = false;
      sync();
    }
  });
  document.addEventListener("visibilitychange", sync);
  reduceMotion.addEventListener("change", () => {
    if (reduceMotion.matches) {
      running = false;
      sync();
    }
  });

  deck.querySelector(".deck-controls").hidden = false;
  show(0);
})();
