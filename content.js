/**
 * GitPulse — content.js
 * Bulletproof floating pill with dynamic injection, MutationObserver,
 * Turbo navigation hooks, and inline style override.
 */

(() => {
  "use strict";

  // ---------- Inline styles (high priority, immune to GitHub CSS) ----------
  const PILL_STYLES = {
    position: "fixed",
    bottom: "32px",
    right: "32px",
    zIndex: "9999999",
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "14px 22px",
    borderRadius: "9999px",
    fontWeight: "900",
    fontSize: "14px",
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    letterSpacing: "0.01em",
    color: "#ffffff",
    cursor: "pointer",
    border: "1px solid rgba(255,255,255,0.2)",
    background: "linear-gradient(135deg, #a855f7 0%, #ec4899 100%)",
    boxShadow: "0 0 20px rgba(168,85,247,0.5), 0 8px 24px rgba(0,0,0,0.35)",
    textShadow: "0 1px 2px rgba(0,0,0,0.25)",
    userSelect: "none",
    outline: "none",
    transition: "transform 0.12s ease, filter 0.15s ease, box-shadow 0.15s ease",
    pointerEvents: "auto",
    margin: "0",
    lineHeight: "1"
  };

  const PILL_BUSY_STYLES = {
    opacity: "0.85",
    cursor: "progress",
    filter: "saturate(1.1)"
  };

  const PILL_HOVER_STYLES = {
    filter: "brightness(1.08)",
    boxShadow: "0 0 28px rgba(168,85,247,0.7), 0 10px 28px rgba(0,0,0,0.4)"
  };

  // ---------- Selectors & limits ----------
  const SELECTORS = [
    ".js-file-content",
    ".diff-table",
    ".blob-code",
    ".blob-code-inner",
    ".blob-code-deletion",
    ".blob-code-addition",
    "[data-testid='diff-code']",
    ".highlight",
    "table.diff-table",
    "pre",
    "code"
  ];

  const MAX_CHARS = 24000;
  const PILL_ID = "gitpulse-pill";
  const SPARKLE = "\u2726";   // ✦
  const BOLT    = "\u26A1";   // ⚡
  const CHECK   = "\u2713";   // ✓
  const CROSS   = "\u2715";   // ✕

  // ---------- State ----------
  let processing = false;
  let observer = null;
  let turboWired = false;

  // ---------- DOM helpers ----------
  function applyStyles(el, styles) {
    for (const k in styles) {
      try { el.style.setProperty(k, styles[k], "important"); }
      catch (_) { el.style[k] = styles[k]; }
    }
  }

  function ensurePill() {
    let pill = document.getElementById(PILL_ID);
    if (pill && pill.isConnected) return pill;

    // Re-create if missing or detached
    if (pill && !pill.isConnected) pill.remove();

    pill = document.createElement("button");
    pill.id = PILL_ID;
    pill.type = "button";
    pill.setAttribute("aria-label", "GitPulse — Analyze with AI");
    pill.setAttribute("data-gitpulse", "true");
    pill.innerHTML = '<span class="gp-sparkle"></span><span class="gp-label">GitPulse</span>';

    // Inline styles
    applyStyles(pill, PILL_STYLES);

    const sparkle = pill.querySelector(".gp-sparkle");
    const label   = pill.querySelector(".gp-label");
    if (sparkle) {
      sparkle.textContent = SPARKLE;
      sparkle.style.cssText = "font-size:14px;line-height:1;display:inline-block;";
    }
    if (label) {
      label.style.cssText = "line-height:1;display:inline-block;";
    }

    // Hover
    pill.addEventListener("mouseenter", () => applyStyles(pill, PILL_HOVER_STYLES));
    pill.addEventListener("mouseleave", () => {
      pill.style.removeProperty("filter");
      pill.style.removeProperty("box-shadow");
    });

    // Click → analyze
    pill.addEventListener("click", onPillClick);

    // Mount
    (document.body || document.documentElement).appendChild(pill);
    return pill;
  }

  function setLabel(text) {
    const pill = document.getElementById(PILL_ID);
    if (!pill) return;
    const label = pill.querySelector(".gp-label");
    if (label) label.textContent = text;
  }

  function setProcessing(state) {
    processing = !!state;
    const pill = document.getElementById(PILL_ID);
    if (!pill) return;
    pill.disabled = !!state;
    applyStyles(pill, state ? PILL_BUSY_STYLES : { opacity: "", cursor: "" });
  }

  // ---------- Language detector ----------
  function detectLanguage() {
    // Try: .final-path or [data-testid="file-title-header-text"]
    const pathEl = document.querySelector(".final-path") ||
                   document.querySelector("[data-testid='file-title-header-text']") ||
                   document.querySelector(".Box-row [data-testid='file-title-header-text']");
    
    if (pathEl) {
      const text = pathEl.textContent || "";
      const match = text.match(/(\.[a-z0-9]+)$/i);
      if (match) return match[1].toLowerCase();
    }

    // Fallback: check breadcrumb or title text
    const breadcrumb = document.querySelector("[data-testid='breadcrumbs']");
    if (breadcrumb) {
      const text = breadcrumb.textContent || "";
      const match = text.match(/(\.[a-z0-9]+)\s*$/);
      if (match) return match[1].toLowerCase();
    }

    // Fallback: parse from page URL
    try {
      const url = new URL(location.href);
      const match = url.pathname.match(/(\.[a-z0-9]+)(?:\?|$)/i);
      if (match) return match[1].toLowerCase();
    } catch (_) {}

    return null; // unknown language
  }

  // ---------- Scraper ----------
  function deepScrape() {
    const seen = new Set();
    const chunks = [];
    let total = 0;

    for (const sel of SELECTORS) {
      let nodes = [];
      try { nodes = Array.from(document.querySelectorAll(sel)); }
      catch (_) { continue; }

      for (const node of nodes) {
        // Don't scrape the pill itself
        if (node.id === PILL_ID || node.closest("#" + PILL_ID)) continue;

        const text = (node.innerText || node.textContent || "").trim();
        if (!text) continue;

        const key = text.slice(0, 120);
        if (seen.has(key)) continue;
        seen.add(key);

        if (total + text.length > MAX_CHARS) {
          const room = Math.max(0, MAX_CHARS - total);
          if (room > 0) {
            chunks.push(text.slice(0, room));
            total += room;
          }
          break;
        }
        chunks.push(text);
        total += text.length;
      }
      if (total >= MAX_CHARS) break;
    }

    let body = chunks.join("\n\n").trim();
    if (body.length > MAX_CHARS) {
      body = body.slice(0, MAX_CHARS) + "\n\n[...truncated for context window...]";
    }
    return body;
  }

  // ---------- Click handler ----------
  async function onPillClick() {
    if (processing) return;

    const code = deepScrape();
    if (!code) {
      setLabel(CROSS + " No Code Found");
      setTimeout(() => setLabel("GitPulse"), 2000);
      return;
    }

    setProcessing(true);
    setLabel(BOLT + " Thinking...");

    try {
      const lang = detectLanguage();
      const response = await chrome.runtime.sendMessage({
        type: "GITPULSE_ANALYZE",
        code,
        url: location.href,
        title: document.title,
        language: lang
      });

      setLabel(response && response.ok ? (CHECK + " Done") : (CROSS + " Error"));
    } catch (err) {
      console.error("[GitPulse] sendMessage failed:", err);
      setLabel(CROSS + " Error");
    } finally {
      setTimeout(() => {
        setProcessing(false);
        setLabel("GitPulse");
      }, 1800);
    }
  }

  // ---------- Bridge from popup ----------
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "GITPULSE_TRIGGER_FROM_POPUP") {
      // The pill may not exist yet on a fresh navigation; ensure it.
      ensurePill();
      onPillClick();
    }
  });

  // ---------- Lifecycle wiring ----------
  function watchMutations() {
    if (observer) return;
    if (!document.body) return; // try again on DOMContentLoaded

    observer = new MutationObserver(() => {
      const pill = document.getElementById(PILL_ID);
      if (!pill || !pill.isConnected) ensurePill();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: false
    });
  }

  function wireTurbo() {
    if (turboWired) return;
    turboWired = true;

    const rehook = () => {
      // Remove a stale pill so we can re-anchor cleanly after Turbo replace.
      const stale = document.getElementById(PILL_ID);
      if (stale && stale.isConnected) stale.remove();
      ensurePill();
    };

    document.addEventListener("turbo:load",    rehook, true);
    document.addEventListener("turbo:render",  rehook, true);
    document.addEventListener("turbo:visit",   rehook, true);
    document.addEventListener("pjax:end",      rehook, true);
    window.addEventListener("popstate",       rehook);
  }

  function hookHistory() {
    const _push = history.pushState;
    const _replace = history.replaceState;
    history.pushState = function () {
      const r = _push.apply(this, arguments);
      setTimeout(ensurePill, 50);
      return r;
    };
    history.replaceState = function () {
      const r = _replace.apply(this, arguments);
      setTimeout(ensurePill, 50);
      return r;
    };
    window.addEventListener("popstate", () => setTimeout(ensurePill, 50));
  }

  function boot() {
    ensurePill();
    watchMutations();
    wireTurbo();
    hookHistory();

    // GitHub can render the file area lazily; re-check for a few seconds.
    let ticks = 0;
    const tick = setInterval(() => {
      ensurePill();
      if (++ticks > 20) clearInterval(tick);
    }, 250);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();