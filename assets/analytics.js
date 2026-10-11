/* Umami website analytics. Events measure actions and visible content, not identity. */
(() => {
  "use strict";
  const config = window.SITE_ANALYTICS;
  if (!config || !config.allowedDomains.includes(location.hostname)) return;

  // The owner can exclude this browser before any request is sent.
  let excluded = false;
  try {
    const setting = new URLSearchParams(location.search).get("analytics");
    excluded = setting === "off";
    if (setting === "off") localStorage.setItem("umami.disabled", "1");
    if (setting === "on") localStorage.removeItem("umami.disabled");
    excluded = excluded || Boolean(localStorage.getItem("umami.disabled"));
  } catch (_) { /* Storage can be unavailable in private browsing. */ }
  if (excluded || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(config.websiteId)) return;

  let ready = false;
  let failed = false;
  const pending = [];
  const send = (name, data = {}) => {
    if (failed) return;
    if (!ready) {
      if (pending.length < 50) pending.push([name, data]);
      return;
    }
    try {
      Promise.resolve(window.umami.track(name, data)).catch(() => {});
    } catch (_) { /* A blocked analytics request must never break navigation. */ }
  };
  const tracker = document.createElement("script");
  tracker.src = config.scriptUrl;
  tracker.defer = true;
  tracker.dataset.websiteId = config.websiteId;
  tracker.dataset.domains = config.allowedDomains.join(",");
  tracker.dataset.performance = "true";
  // Hash jumps are custom events, so they should not inflate pageview counts.
  tracker.dataset.excludeHash = "true";
  tracker.dataset.beforeSend = "siteAnalyticsBeforeSend";
  window.siteAnalyticsBeforeSend = (type, payload) => {
    try {
      if (localStorage.getItem("umami.disabled")) return false;
    } catch (_) {}
    return payload;
  };
  tracker.addEventListener("error", () => {
    failed = true;
    pending.length = 0;
  });
  tracker.addEventListener("load", () => {
    ready = Boolean(window.umami && typeof window.umami.track === "function");
    if (!ready) { failed = true; pending.length = 0; return; }
    pending.splice(0).forEach(([name, data]) => send(name, data));
    try {
      Promise.resolve(window.umami.identify({
        viewport: `${innerWidth}x${innerHeight}`,
        pixel_ratio: devicePixelRatio,
        color_scheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
        reduced_motion: matchMedia("(prefers-reduced-motion: reduce)").matches
      })).catch(() => {});
    } catch (_) {}
    if (config.recorderUrl) {
      const recorder = document.createElement("script");
      recorder.src = config.recorderUrl;
      recorder.defer = true;
      recorder.dataset.websiteId = config.websiteId;
      document.head.append(recorder);
    }
  });
  document.head.append(tracker);

  const cleanTarget = url => url.origin + url.pathname;
  const linkClick = event => {
    if ((event.type === "click" && event.button !== 0) ||
        (event.type === "auxclick" && event.button !== 1)) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!anchor) return;
    const url = new URL(anchor.href, location.href);
    const label = anchor.textContent.trim().replace(/\s+/g, " ").slice(0, 100);
    const paper = anchor.closest(".paper");
    const section = anchor.closest("section");
    const area = section ? section.id : anchor.closest(".intro") ? "intro" : "footer";
    if (anchor.hasAttribute("data-cv-link")) {
      send("cv-open", { area });
    } else if (anchor.closest(".contact")) {
      send("contact-click", { label });
    } else if (anchor.closest(".paper-links")) {
      send("paper-link", { paper: paper.id, resource: label, target: cleanTarget(url) });
    } else if (anchor.classList.contains("paper-image")) {
      send("figure-open", { paper: paper.id });
    } else if (url.origin === location.origin && url.pathname === location.pathname && url.hash) {
      send("section-jump", { destination: url.hash.slice(1), area });
    } else if (url.protocol === "https:" || url.protocol === "http:") {
      send("external-link", { label, target: cleanTarget(url), area });
    }
    // Do not intercept default navigation, modifier keys, or opening a new tab.
  };
  document.addEventListener("click", linkClick, { capture: true, passive: true });
  document.addEventListener("auxclick", linkClick, { capture: true, passive: true });

  const scrollMarks = new Set();
  let maxScroll = 0;
  let scrollFrame = false;
  const measureScroll = () => {
    scrollFrame = false;
    if (document.visibilityState !== "visible") return;
    const height = document.documentElement.scrollHeight;
    maxScroll = Math.max(maxScroll, Math.min(100, Math.round((scrollY + innerHeight) / height * 100)));
    for (const depth of [25, 50, 75, 90, 100]) {
      if (maxScroll >= depth && !scrollMarks.has(depth)) {
        scrollMarks.add(depth);
        send("scroll-depth", { percent: depth });
      }
    }
  };
  window.addEventListener("scroll", () => {
    if (!scrollFrame) { scrollFrame = true; requestAnimationFrame(measureScroll); }
  }, { passive: true });
  window.addEventListener("resize", measureScroll, { passive: true });
  measureScroll();

  // Count one impression only after content remains visible for a second.
  const contents = [...document.querySelectorAll(".intro, main > section, .paper")];
  const impressions = new Set();
  const visible = new Set();
  const timers = new Map();
  const contentKey = element => element.id || "intro";
  const queueImpression = element => {
    if (impressions.has(element) || timers.has(element)) return;
    timers.set(element, setTimeout(() => {
      timers.delete(element);
      if (document.visibilityState !== "visible" || !visible.has(element)) return;
      impressions.add(element);
      const isPaper = element.classList.contains("paper");
      send(isPaper ? "paper-view" : "section-view", { [isPaper ? "paper" : "section"]: contentKey(element) });
    }, 1000));
  };
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(({ target, isIntersecting }) => {
        if (isIntersecting) {
          visible.add(target);
          queueImpression(target);
        } else {
          visible.delete(target);
          clearTimeout(timers.get(target));
          timers.delete(target);
        }
      });
    }, { rootMargin: "-10% 0px -10% 0px", threshold: 0 });
    contents.forEach(element => observer.observe(element));
  }

  // Foreground time stops when hidden; milestones bound the number of events.
  let visibleMs = 0;
  let lastTick = performance.now();
  let wasVisible = document.visibilityState === "visible";
  let previousSummaryMs = 0;
  const timeMarks = new Set();
  const tick = () => {
    const now = performance.now();
    if (wasVisible) visibleMs += Math.max(0, Math.min(now - lastTick, 2000));
    lastTick = now;
    wasVisible = document.visibilityState === "visible";
    for (const seconds of [15, 30, 60, 120, 300]) {
      if (visibleMs >= seconds * 1000 && !timeMarks.has(seconds)) {
        timeMarks.add(seconds);
        send("visible-time", { seconds });
      }
    }
  };
  const summarize = () => {
    const delta = visibleMs - previousSummaryMs;
    if (delta < 1000) return;
    send("visit-summary", { visible_seconds: Math.round(delta / 1000), max_scroll: maxScroll });
    previousSummaryMs = visibleMs;
  };
  let clock = setInterval(tick, 1000);
  document.addEventListener("visibilitychange", () => {
    tick();
    if (document.visibilityState === "hidden") {
      summarize();
      timers.forEach(clearTimeout);
      timers.clear();
    } else {
      visible.forEach(queueImpression);
      measureScroll();
    }
  });
  window.addEventListener("pagehide", () => { tick(); summarize(); clearInterval(clock); });
  window.addEventListener("pageshow", event => {
    if (event.persisted) { lastTick = performance.now(); wasVisible = true; clock = setInterval(tick, 1000); }
  });

  // Record error categories and public asset paths, not exception messages or stacks.
  window.addEventListener("error", event => {
    const source = event.filename || event.target?.src || event.target?.href;
    if (!source) return;
    try {
      const url = new URL(source, location.href);
      if (url.origin !== location.origin) return;
      send("site-error", { type: event.message ? "javascript" : "asset", source: url.pathname });
    } catch (_) {}
  }, true);
  window.addEventListener("unhandledrejection", () => send("site-error", { type: "promise" }));
})();
