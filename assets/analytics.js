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

  const kinds = new Set(["paper", "section", "figure", "shortcut", "link", "document"]);
  const descriptor = element => {
    const value = element.getAttribute("data-analytics") ||
      (element.classList.contains("paper") ? `paper:${element.id}` :
        `section:${element.id || "intro"}`);
    const [kind, id] = value.split(":");
    // The longest event name stays below Umami's 50-character limit.
    return kinds.has(kind) && /^[a-z0-9-]{1,28}$/.test(id || "") ? { kind, id } : null;
  };
  const related = element => {
    const paper = element.closest(".paper");
    const section = element.closest("section");
    return {
      ...(paper ? { paper: paper.id } : {}),
      section: section ? section.id : element.closest(".intro") ? "intro" : "footer"
    };
  };
  const linkClick = event => {
    if ((event.type === "click" && event.button !== 0) ||
        (event.type === "auxclick" && event.button !== 1)) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[data-analytics]") : null;
    if (!anchor) return;
    const item = descriptor(anchor);
    if (!item) return;
    const url = new URL(anchor.href, location.href);
    send(`${item.kind}-click:${item.id}`, {
      ...related(anchor),
      // Never copy outbound queries, fragments, email addresses, or share tokens.
      ...(url.protocol === "https:" || url.protocol === "http:" ? { target: url.origin + url.pathname } : {})
    });
    // Each click has one event, preserving default navigation and modifier keys.
  };
  document.addEventListener("click", linkClick, { capture: true, passive: true });
  document.addEventListener("auxclick", linkClick, { capture: true, passive: true });

  const contents = new Map();
  document.querySelectorAll(".intro, main > section, .paper, [data-analytics]").forEach(element => {
    const item = descriptor(element);
    if (item) contents.set(element, {
      ...item, element, inViewport: false, visible: false, reached: false, viewed: false,
      visibleMs: 0, reportedMs: 0, marks: new Set(), timer: null
    });
  });
  const milestones = [15, 30, 60, 120, 300];
  const pageMarks = new Set();
  let visibleMs = 0;
  let reportedPageMs = 0;
  let lastTick = performance.now();
  let wasVisible = document.visibilityState === "visible";
  let paused = false;
  let maxScroll = 0;
  const markTime = (ms, marks, prefix) => {
    milestones.forEach(seconds => {
      if (ms >= seconds * 1000 && !marks.has(seconds)) {
        marks.add(seconds);
        send(`${prefix}:${seconds}s`);
      }
    });
  };
  const tick = () => {
    const now = performance.now();
    // Cap a delayed tick so suspended browsers/devices do not count as visible time.
    const delta = wasVisible && !paused ? Math.max(0, Math.min(now - lastTick, 2000)) : 0;
    lastTick = now;
    visibleMs += delta;
    markTime(visibleMs, pageMarks, "page-stay");
    contents.forEach(item => {
      if (!item.visible) return;
      item.visibleMs += delta;
      markTime(item.visibleMs, item.marks, `${item.kind}-stay:${item.id}`);
    });
    wasVisible = document.visibilityState === "visible";
  };
  const cancelView = item => {
    clearTimeout(item.timer);
    item.timer = null;
  };
  const queueView = item => {
    if (!item.visible || paused || document.visibilityState !== "visible") return;
    if (!item.reached) {
      item.reached = true;
      send(`${item.kind}-reach:${item.id}`);
    }
    if (item.viewed || item.timer !== null) return;
    const image = item.kind === "figure" ? item.element.querySelector("img") : null;
    if (image && (!image.complete || !image.naturalWidth)) return;
    item.timer = setTimeout(() => {
      item.timer = null;
      if (!item.visible || paused || document.visibilityState !== "visible") return;
      item.viewed = true;
      send(`${item.kind}-view:${item.id}`);
    }, 1000);
  };
  const reportTime = item => {
    const seconds = Math.floor((item.visibleMs - item.reportedMs) / 1000);
    if (!seconds) return;
    send(`${item.kind}-time:${item.id}`, { ...related(item.element), visible_seconds: seconds });
    // Carry fractional seconds forward instead of rounding every visible segment.
    item.reportedMs += seconds * 1000;
  };
  const summarize = () => {
    contents.forEach(reportTime);
    const seconds = Math.floor((visibleMs - reportedPageMs) / 1000);
    if (!seconds) return;
    send("page-summary", { visible_seconds: seconds, max_scroll: maxScroll });
    reportedPageMs += seconds * 1000;
  };
  const updateVisibility = item => {
    const image = item.kind === "figure" ? item.element.querySelector("img") : null;
    const visible = item.inViewport && (!image || (image.complete && image.naturalWidth > 0));
    if (item.visible === visible) return;
    item.visible = visible;
    if (visible) queueView(item);
    else { cancelView(item); reportTime(item); }
  };
  if ("IntersectionObserver" in window) {
    // Sections span many viewports; papers need 25%, small targets need 50%.
    [0, 0.25, 0.5].forEach(threshold => {
      const observer = new IntersectionObserver(entries => {
        tick();
        entries.forEach(({ target, isIntersecting, intersectionRatio }) => {
          const item = contents.get(target);
          item.inViewport = isIntersecting && intersectionRatio >= threshold;
          updateVisibility(item);
        });
      }, { rootMargin: "-10% 0px -10% 0px", threshold });
      contents.forEach(item => {
        const minimum = item.kind === "section" ? 0 : item.kind === "paper" ? 0.25 : 0.5;
        if (minimum !== threshold) return;
        observer.observe(item.element);
        if (item.kind === "figure") item.element.querySelector("img")?.addEventListener("load", () => {
          tick();
          updateVisibility(item);
        });
      });
    });
  }

  const scrollMarks = new Set();
  let scrollFrame = false;
  const measureScroll = () => {
    scrollFrame = false;
    if (document.visibilityState !== "visible" || paused) return;
    const height = document.documentElement.scrollHeight;
    maxScroll = Math.max(maxScroll, Math.min(100, Math.floor((scrollY + innerHeight) / height * 100)));
    for (const depth of [25, 50, 75, 90, 100]) {
      if (maxScroll >= depth && !scrollMarks.has(depth)) {
        scrollMarks.add(depth);
        send(`scroll-reach:${depth}`);
      }
    }
  };
  window.addEventListener("scroll", () => {
    if (!scrollFrame) { scrollFrame = true; requestAnimationFrame(measureScroll); }
  }, { passive: true });
  window.addEventListener("resize", measureScroll, { passive: true });
  measureScroll();

  let clock = setInterval(tick, 1000);
  document.addEventListener("visibilitychange", () => {
    tick();
    if (document.visibilityState === "hidden") {
      summarize();
      contents.forEach(cancelView);
    } else {
      contents.forEach(queueView);
      measureScroll();
    }
  });
  window.addEventListener("pagehide", () => {
    tick();
    paused = true;
    wasVisible = false;
    summarize();
    contents.forEach(cancelView);
    clearInterval(clock);
  });
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    paused = false;
    lastTick = performance.now();
    wasVisible = document.visibilityState === "visible";
    clearInterval(clock);
    clock = setInterval(tick, 1000);
    contents.forEach(queueView);
    measureScroll();
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
