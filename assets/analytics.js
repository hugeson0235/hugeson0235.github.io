/* One pageview on arrival, one event per click, one summary on departure. */
(() => {
  "use strict";
  const config = window.SITE_ANALYTICS;
  if (!config || !config.allowedDomains.includes(location.hostname)) return;

  // Exclude the owner's browser before loading the tracker.
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
  const send = (name, data) => {
    if (failed) return;
    try {
      if (localStorage.getItem("umami.disabled")) return;
    } catch (_) {}
    if (!ready) {
      if (pending.length < 50) pending.push([name, data]);
      return;
    }
    try {
      const request = name === undefined ? window.umami.track() : window.umami.track(name, data);
      Promise.resolve(request).catch(() => {});
    } catch (_) { /* Analytics failures must never interrupt navigation. */ }
  };
  const tracker = document.createElement("script");
  tracker.src = config.scriptUrl;
  tracker.defer = true;
  tracker.dataset.websiteId = config.websiteId;
  tracker.dataset.domains = config.allowedDomains.join(",");
  tracker.dataset.autoTrack = "false";
  tracker.dataset.autoPageview = "false";
  tracker.dataset.performance = "false";
  tracker.dataset.excludeHash = "true";
  // No before-send hook: start the native keepalive request synchronously on departure.
  tracker.addEventListener("error", () => { failed = true; pending.length = 0; });
  tracker.addEventListener("load", () => {
    ready = Boolean(window.umami && typeof window.umami.track === "function");
    if (!ready) { failed = true; pending.length = 0; return; }
    pending.splice(0).forEach(([name, data]) => send(name, data));
  });

  let startedAt = performance.now();
  let visibleAt = document.visibilityState === "visible" ? startedAt : null;
  let visibleMs = 0;
  let clicks = 0;
  let maxScroll = 0;
  let ended = false;
  // Queue arrival first, even if the tracker has not loaded yet. No duplicate custom event.
  send();
  document.head.append(tracker);

  const related = element => {
    const paper = element.closest(".paper");
    const section = element.closest("section");
    return {
      ...(paper ? { paper: paper.id } : {}),
      section: section ? section.id : element.closest(".intro") ? "intro" :
        element.closest("footer") ? "footer" : "page"
    };
  };
  const kinds = new Set(["paper", "section", "figure", "shortcut", "link", "document"]);
  const click = event => {
    if (ended || !(event.target instanceof Element)) return;
    if ((event.type === "click" && event.button !== 0) ||
        (event.type === "auxclick" && event.button !== 1)) return;
    const interactive = event.target.closest("a, button, [role='button'], [data-analytics]");
    // Middle-click only activates links; right-click is a context menu, not a site action.
    if (event.type === "auxclick" && !interactive?.closest("a")) return;
    const element = interactive || event.target;
    const context = related(element);
    const annotated = element.getAttribute("data-analytics") || "";
    const [kind, id] = annotated.split(":");
    const stable = kinds.has(kind) && /^[a-z0-9-]{1,28}$/.test(id || "");
    const category = stable ? kind : interactive ? "link" : context.paper ? "paper" :
      context.section === "page" ? "page" : "section";
    const target = stable ? annotated : `${category}:${context.paper || context.section}`;
    const label = (element.getAttribute("aria-label") || element.getAttribute("alt") ||
      element.textContent || target).replace(/\s+/g, " ").trim().slice(0, 120);
    const data = { category, target, label, ...context };
    const href = interactive?.getAttribute("href");
    if (href) {
      try {
        const url = new URL(href, location.href);
        // Stable shortcut IDs retain their target; outbound queries/fragments are omitted.
        if (category === "shortcut") data.destination = `#${id}`;
        else if (url.protocol === "https:" || url.protocol === "http:") {
          data.destination = (url.origin + url.pathname).slice(0, 500);
        }
      } catch (_) {}
    }
    clicks += 1;
    send("click", data);
    // Do not prevent, delay, or replace the browser's default navigation.
  };
  document.addEventListener("click", click, { capture: true, passive: true });
  document.addEventListener("auxclick", click, { capture: true, passive: true });

  const measureScroll = () => {
    if (ended || document.visibilityState !== "visible") return;
    const height = document.documentElement.scrollHeight;
    if (height > 0) maxScroll = Math.max(maxScroll,
      Math.min(100, Math.max(0, Math.floor((scrollY + innerHeight) / height * 100))));
  };
  window.addEventListener("scroll", measureScroll, { passive: true });
  window.addEventListener("resize", measureScroll, { passive: true });
  measureScroll();

  document.addEventListener("visibilitychange", () => {
    if (ended) return;
    const now = performance.now();
    if (visibleAt !== null) visibleMs += Math.max(0, now - visibleAt);
    visibleAt = document.visibilityState === "visible" ? now : null;
    measureScroll();
    // Switching tabs/apps updates local timing only; it does not send an event.
  });
  window.addEventListener("pagehide", () => {
    if (ended) return;
    const now = performance.now();
    if (visibleAt !== null) visibleMs += Math.max(0, now - visibleAt);
    measureScroll();
    ended = true;
    visibleAt = null;
    // Umami's native transport uses fetch keepalive. Departure delivery is best effort.
    send("page-leave", {
      visible_seconds: Math.floor(visibleMs / 1000),
      elapsed_seconds: Math.floor(Math.max(0, now - startedAt) / 1000),
      clicks,
      max_scroll: maxScroll
    });
  });
  window.addEventListener("pageshow", event => {
    if (!event.persisted || !ended) return;
    // Returning from the back/forward cache starts a new arrival/departure cycle.
    startedAt = performance.now();
    visibleAt = document.visibilityState === "visible" ? startedAt : null;
    visibleMs = 0;
    clicks = 0;
    maxScroll = 0;
    ended = false;
    measureScroll();
    send();
  });
})();
