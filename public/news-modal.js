(function () {
  // ------- Config -------
  const CFG = {
    endpoint:
      (window.AlNewsConfig && window.AlNewsConfig.endpoint) ||
      "public/news.latest.json",
    autoDelayMs: 5000,              // show 5s after items are fetched
    freshHours: 168,                // for badges, not required for auto-show
    requireFreshForAutoShow: false, // <<< auto-show if we have ANY items
    snoozeDays: 7,
    localKey: "al_news_snooze_until",
    logo:
      (window.AlNewsConfig && window.AlNewsConfig.logo) ||
      "public/images/asianloop.jpg",
  };

  // ------- State / refs -------
  let state = {
    items: [],
    fresh: false,
    openedManually: false,
    visibleCount: 6, // top + 5 more initially
  };
  let els = {};

  // ------- Utils -------
  const qs = (s, r = document) => r.querySelector(s);
  const ce = (t, p = {}) => Object.assign(document.createElement(t), p);
  const now = () => Date.now();
  const addDays = (d) => new Date(now() + d * 864e5);
  const isFresh = (iso) =>
    now() - new Date(iso).getTime() <= CFG.freshHours * 3600 * 1000;
  const fmtRel = (iso) => {
    const ms = now() - new Date(iso).getTime();
    const h = Math.floor(ms / 3600000),
      d = Math.floor(h / 24);
    if (h < 24) return `${h}h ago`;
    return `${d}d ago`;
  };
  function normalizeLink(href) {
    try {
      const u = new URL(href);
      if (u.hostname.includes("news.google.com") && u.searchParams.has("url")) {
        return u.searchParams.get("url");
      }
    } catch (_) {}
    return href;
  }
  function hostFrom(href) {
    try {
      return new URL(href).hostname.replace(/^www\./, "");
    } catch (_) {
      return "";
    }
  }

  // ------- Build DOM -------
  function buildModal() {
    if (els.backdrop) return;

    // Backdrop + container
    els.backdrop = ce("div", {
      className: "al-news-backdrop al-news-hidden",
      "aria-hidden": "true",
    });
    els.modal = ce("div", {
      className: "al-news-modal al-news-hidden",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "al-news-title",
    });

    // Header
    const hdr = ce("div", { className: "al-news-header" });
    const logo = ce("img", {
      className: "al-news-logo",
      alt: "Asianloop",
      src: CFG.logo,
    });
    // graceful fallback if logo 404s
    logo.addEventListener("error", () => {
      logo.src =
        "data:image/svg+xml;utf8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" rx="7" fill="#0f62fe"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, Arial" font-weight="800" font-size="12" fill="#fff">AL</text></svg>'
        );
    });
    const title = ce("div", {
      className: "al-news-title",
      id: "al-news-title",
      textContent: "Latest Custody-Metering News",
    });
    const spacer = ce("div", { className: "al-news-spacer" });
    const btnClose = ce("button", {
      className: "al-news-close",
      "aria-label": "Close news",
      innerHTML: "✕",
    });
    btnClose.addEventListener("click", close);

    hdr.append(logo, title, spacer, btnClose);

    // Body
    els.body = ce("div", { className: "al-news-body" });

    // Footer
    const ftr = ce("div", { className: "al-news-footer" });
    const label = ce("label");
    const cb = ce("input", { type: "checkbox", id: "al-news-snooze" });
    const cbText = ce("span", { textContent: "Don’t show again this week" });
    label.append(cb, cbText);
    cb.addEventListener("change", (e) => {
      if (e.target.checked)
        localStorage.setItem(CFG.localKey, addDays(CFG.snoozeDays).toISOString());
      else localStorage.removeItem(CFG.localKey);
    });

    const trailing = ce("div", { className: "trailing" });
    const btnMore = ce("button", { className: "al-btn", textContent: "Load more" });
    btnMore.addEventListener("click", () => {
      state.visibleCount = Math.min(30, state.visibleCount + 6);
      renderList();
      if (state.visibleCount >= Math.min(30, state.items.length))
        btnMore.disabled = true;
    });
    const btnClose2 = ce("button", { className: "al-btn", textContent: "Close" });
    btnClose2.addEventListener("click", close);
    trailing.append(btnMore, btnClose2);
    els.btnMore = btnMore;

    ftr.append(label, trailing);

    // Compose
    els.modal.append(hdr, els.body, ftr);
    document.body.append(els.backdrop, els.modal);

    // Backdrop / keyboard
    els.backdrop.addEventListener("click", close, { passive: true });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  // ------- Rendering -------
  function render(items) {
    els.body.innerHTML = "";
    if (!items || !items.length) {
      els.body.append(
        ce("div", {
          className: "al-news-meta",
          textContent: "No new items in the last few days.",
        })
      );
      if (els.btnMore) els.btnMore.disabled = true;
      return;
    }

    // Top story
    const top = items[0];
    const topHref = normalizeLink(top.url);
    const topHost = hostFrom(topHref) || top.sourceName || "";

    const topEl = ce("div", { className: "al-news-top" });
    const meta = ce("div", { className: "al-news-meta" });
    const chip = ce("span", {
      className: "al-badge",
      textContent: top.category || "Update",
    });
    meta.append(
      chip,
      document.createTextNode(`· ${fmtRel(top.publishedAt)} · ${topHost}`)
    );

    const h3 = ce("h3");
    const aTop = ce("a", {
      href: topHref,
      target: "_blank",
      rel: "noopener",
      textContent: top.title,
    });
    h3.append(aTop);

    const sum = ce("div", {
      className: "al-news-meta",
      textContent: top.summary || "",
    });

    const actions = ce("div", { className: "al-news-actions" });
    const read = ce("button", { className: "al-btn primary", textContent: "Read full" });
    read.addEventListener("click", () => window.open(topHref, "_blank"));
    const share = ce("button", { className: "al-btn", textContent: "Share" });
    share.addEventListener("click", () => {
      const msg = encodeURIComponent(`${top.title} — ${topHost}\n${topHref}`);
      window.open(`https://wa.me/?text=${msg}`, "_blank");
    });
    actions.append(read, share);

    topEl.append(meta, h3, sum, actions);
    els.body.append(topEl);

    // List container + first batch
    els.list = ce("div", { className: "al-news-list" });
    els.body.append(els.list);
    renderList();
  }

  function renderList() {
    if (!els.list) return;
    const limit = Math.min(30, state.visibleCount, state.items.length);
    els.list.innerHTML = "";
    // slice from 1: index 0 is top story
    state.items.slice(1, limit).forEach((it) => {
      const href = normalizeLink(it.url);
      const host = hostFrom(href) || it.sourceName || "";
      const row = ce("div", { className: "al-news-item" });
      const a = ce("a", { href, target: "_blank", rel: "noopener" });
      a.textContent = `• ${it.title} · ${fmtRel(it.publishedAt)} · ${host}`;
      row.append(a);
      els.list.append(row);
    });
    if (els.btnMore) els.btnMore.disabled = limit >= Math.min(30, state.items.length);
  }

  // ------- Open / Close -------
  function open(manual = false) {
    state.openedManually = manual;
    els.backdrop.classList.remove("al-news-hidden");
    els.modal.classList.remove("al-news-hidden");
    // force a tick so transitions apply
    requestAnimationFrame(() => {
      els.backdrop.classList.add("is-open");
      els.modal.classList.add("is-open");
    });
  }

  function close() {
    // guard if DOM not built yet
    if (!els.modal || els.modal.classList.contains("al-news-hidden")) return;
    els.backdrop.classList.remove("is-open");
    els.modal.classList.remove("is-open");
    setTimeout(() => {
      els.backdrop.classList.add("al-news-hidden");
      els.modal.classList.add("al-news-hidden");
    }, 180);
  }

  // expose a tiny API for the header link
  window.AlNewsModal = {
    open: () => open(true),
    close,
  };

  // ------- Data -------
  async function fetchItems() {
    try {
      const res = await fetch(CFG.endpoint, { cache: "no-store" });
      const json = await res.json();
      const items = (json.items || []).slice(0, 30);
      state.items = items;
      state.fresh = items.some((it) => isFresh(it.publishedAt));
      // preserve user-expanded count on refresh
      state.visibleCount = Math.max(6, state.visibleCount);
      render(items);
    } catch (e) {
      state.items = [];
      state.fresh = false;
      render([]);
    }
  }

  function shouldAutoShow() {
    // snooze check
    const snoozeUntil = localStorage.getItem(CFG.localKey);
    if (snoozeUntil && new Date(snoozeUntil).getTime() > now()) return false;

    // gate
    if (CFG.requireFreshForAutoShow) return state.fresh;
    return state.items.length > 0; // <<< show if we have any items
  }

  // ------- Boot -------
  document.addEventListener("DOMContentLoaded", async () => {
    buildModal();

    // Hook manual trigger if present
    const hook = qs("#al-latest-news");
    if (hook)
      hook.addEventListener("click", (e) => {
        e.preventDefault();
        window.AlNewsModal.open();
      });

    // 1) fetch data first
    await fetchItems();

    // 2) allow force-open for testing
    const url = new URL(window.location.href);
    if (url.searchParams.get("news") === "1" || window.location.hash === "#news") {
      return open(true);
    }

    // 3) auto-show after delay if allowed
    setTimeout(() => {
      if (shouldAutoShow()) open(false);
    }, CFG.autoDelayMs);
  });
})();
