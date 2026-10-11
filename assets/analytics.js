/* Native pageviews plus one clearly named event per click. */
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
  // No before-send hook or automatic events.
  tracker.addEventListener("error", () => { failed = true; pending.length = 0; });
  tracker.addEventListener("load", () => {
    ready = Boolean(window.umami && typeof window.umami.track === "function");
    if (!ready) { failed = true; pending.length = 0; return; }
    pending.splice(0).forEach(([name, data]) => send(name, data));
  });

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
  const paperNames = { agentrvos: "AgentRVOS", playground: "PLAYGROUND", ask4nv: "Ask4NV", reanchor: "ReAnchor" };
  const sectionNames = {
    intro: "Introduction", research: "Research", experience: "Experience",
    education: "Education", awards: "Honors & Awards", footer: "Footer"
  };
  const click = event => {
    if (!(event.target instanceof Element)) return;
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
    let name = label || target;
    if (category === "shortcut") name = `Shortcut / ${paperNames[id] || sectionNames[id] || label}`;
    else if (category === "figure") name = `${paperNames[context.paper] || context.paper} / Figure 3`;
    else if (category === "paper") name = `${paperNames[context.paper] || context.paper} / Text`;
    else if (category === "section") name = `Section / ${sectionNames[context.section] || context.section}`;
    else if (category === "page") name = "Page / Background";
    else if (context.paper) name = `${paperNames[context.paper] || context.paper} / ${label}`;
    // The Events chart itself shows the clicked target; Properties retain the full details.
    send(`click: ${name}`.slice(0, 50), data);
    // Do not prevent, delay, or replace the browser's default navigation.
  };
  document.addEventListener("click", click, { capture: true, passive: true });
  document.addEventListener("auxclick", click, { capture: true, passive: true });

  window.addEventListener("pageshow", event => {
    // A real back/forward-cache restoration counts as a new native pageview.
    if (event.persisted) send();
  });
})();
