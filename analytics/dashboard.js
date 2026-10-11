(() => {
  "use strict";
  const config = window.SITE_ANALYTICS || {};
  const base = config.dashboardUrl || "https://cloud.umami.is";
  document.getElementById("open-dashboard").href = config.dashboardLinks?.board || base;
  document.querySelectorAll("[data-dashboard]").forEach(link => {
    link.href = config.dashboardLinks?.[link.dataset.dashboard] || base;
  });
  document.getElementById("connection-status").textContent = config.websiteId
    ? "Umami 사이트 연결 설정 완료 · 무료 Cloud"
    : "사이트 ID 연결 대기 중";

  const checkbox = document.getElementById("exclude-browser");
  const exclusionStatus = document.getElementById("exclude-status");
  const showExclusion = () => {
    try {
      checkbox.checked = Boolean(localStorage.getItem("umami.disabled"));
      exclusionStatus.textContent = checkbox.checked ? "이 브라우저의 방문을 제외합니다." : "이 브라우저의 홈페이지 방문을 수집합니다.";
    } catch (_) {
      exclusionStatus.textContent = "브라우저 저장이 제한되어 있습니다. 아래 제외 링크를 사용하세요.";
    }
  };
  showExclusion();
  checkbox.addEventListener("change", () => {
    try {
      if (checkbox.checked) localStorage.setItem("umami.disabled", "1");
      else localStorage.removeItem("umami.disabled");
    } catch (_) {}
    showExclusion();
  });

  const form = document.getElementById("campaign-form");
  const source = document.getElementById("campaign-source");
  const medium = document.getElementById("campaign-medium");
  const campaign = document.getElementById("campaign-name");
  const result = document.getElementById("campaign-result");
  const status = document.getElementById("copy-status");
  const buildLink = () => {
    const url = new URL("https://hugeson0235.github.io/");
    if (source.value.trim()) url.searchParams.set("utm_source", source.value.trim());
    if (medium.value.trim()) url.searchParams.set("utm_medium", medium.value.trim());
    if (campaign.value.trim()) url.searchParams.set("utm_campaign", campaign.value.trim());
    result.value = url.href;
    status.textContent = "";
  };
  form.addEventListener("submit", event => event.preventDefault());
  form.addEventListener("input", buildLink);
  document.querySelectorAll("[data-source]").forEach(button => button.addEventListener("click", () => {
    source.value = button.dataset.source;
    medium.value = button.dataset.medium;
    buildLink();
  }));
  document.getElementById("copy-campaign").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(result.value);
      status.textContent = "복사했습니다.";
    } catch (_) {
      result.focus();
      result.select();
      status.textContent = "선택된 링크를 복사하세요.";
    }
  });
  buildLink();
})();
