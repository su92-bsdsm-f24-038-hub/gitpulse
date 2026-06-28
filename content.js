/**
 * GitPulse — content.js (Blind Code Gatherer)
 * Sweeps entire visible DOM code areas without language assumptions.
 * Extracts raw code text, joins cleanly, and sends to background.js.
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

  // ---------- DOM Container Selectors (GitHub code viewers) ----------
  const CODE_CONTAINERS = [
    ".blob-code",
    ".blob-code-inner",
    ".js-file-content",
    "table.highlight",
    "[data-testid='diff-code']",
    ".diff-table",
    ".Box-row",
    "[data-testid='file-content-header']",
    "pre",
    "code"
  ];

  const FALLBACK_CONTAINERS = [
    "[data-testid='file-content-container']",
    ".file-content",
    ".blob-wrapper",
    ".container-lg",
    "main",
    "article"
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

    if (pill && !pill.isConnected) pill.remove();

    pill = document.createElement("button");
    pill.id = PILL_ID;
    pill.type = "button";
    pill.setAttribute("aria-label", "GitPulse — Analyze with AI");
    pill.setAttribute("data-gitpulse", "true");
    pill.innerHTML = '<span class="gp-sparkle"></span><span class="gp-label">GitPulse</span>';

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

    pill.addEventListener("mouseenter", () => applyStyles(pill, PILL_HOVER_STYLES));
    pill.addEventListener("mouseleave", () => {
      pill.style.removeProperty("filter");
      pill.style.removeProperty("box-shadow");
    });

    pill.addEventListener("click", onPillClick);

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

  // ---------- Blind Code Scraper (NO language assumptions) ----------
  function blindCodeSweep() {
    const lines = [];
    const seen = new Set();
    let totalChars = 0;

    // First pass: sweep primary code containers
    for (const selector of CODE_CONTAINERS) {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch (_) {
        continue;
      }

      for (const node of nodes) {
        // Skip the pill itself
        if (node.id === PILL_ID || node.closest("#" + PILL_ID)) continue;

        // Extract text content
        let text = node.innerText || node.textContent || "";
        text = text.trim();

        if (!text) continue;

        // Deduplicate by first 200 chars
        const key = text.slice(0, 200);
        if (seen.has(key)) continue;
        seen.add(key);

        // Split on newlines and filter empty lines
        const nodeLines = text.split(/\r?\n/).filter(line => line.length > 0);

        for (const line of nodeLines) {
          if (totalChars + line.length + 1 > MAX_CHARS) {
            const room = Math.max(0, MAX_CHARS - totalChars);
            if (room > 0) {
              lines.push(line.slice(0, room));
              totalChars += room;
            }
            return lines.join("\n");
          }
          lines.push(line);
          totalChars += line.length + 1;
        }

        if (totalChars >= MAX_CHARS) {
          return lines.join("\n");
        }
      }
    }

    // If still empty, try fallback containers (broader sweep)
    if (lines.length === 0) {
      for (const selector of FALLBACK_CONTAINERS) {
        let nodes = [];
        try {
          nodes = Array.from(document.querySelectorAll(selector));
        } catch (_) {
          continue;
        }

        for (const node of nodes) {
          if (node.id === PILL_ID || node.closest("#" + PILL_ID)) continue;

          let text = node.innerText || node.textContent || "";
          text = text.trim();

          if (!text || text.length < 20) continue;

          // Only grab code-like lines (no UI nav/menu spam)
          const codeLines = text.split(/\r?\n/)
            .filter(line => {
              const trimmed = line.trim();
              // Skip GitHub UI lines
              if (trimmed.match(/^(Conversation|Code|Pull|Issues|GitHub)/i)) return false;
              if (trimmed.match(/^(Fork|Star|Watch|Sponsor)/i)) return false;
              if (trimmed.length === 0) return false;
              return true;
            });

          if (codeLines.length === 0) continue;

          const key = codeLines.slice(0, 3).join("|");
          if (seen.has(key)) continue;
          seen.add(key);

          for (const line of codeLines) {
            if (totalChars + line.length + 1 > MAX_CHARS) {
              const room = Math.max(0, MAX_CHARS - totalChars);
              if (room > 0) {
                lines.push(line.slice(0, room));
                totalChars += room;
              }
              return lines.join("\n");
            }
            lines.push(line);
            totalChars += line.length + 1;
          }

          if (totalChars >= MAX_CHARS) {
            return lines.join("\n");
          }
        }
      }
    }

    let result = lines.join("\n").trim();
    if (result.length > MAX_CHARS) {
      result = result.slice(0, MAX_CHARS) + "\n\n[...truncated for context window...]";
    }
    return result;
  }

  // ---------- Click handler ----------
  async function onPillClick() {
    if (processing) return;

    const code = blindCodeSweep();
    if (!code || code.length < 5) {
      setLabel(CROSS + " No Code");
      setTimeout(() => setLabel("GitPulse"), 2000);
      return;
    }

    setProcessing(true);
    setLabel(BOLT + " Thinking...");

    try {
      const response = await chrome.runtime.sendMessage({
        type: "GITPULSE_ANALYZE",
        code,
        url: location.href,
        title: document.title
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
      ensurePill();
      onPillClick();
    }
  });

  // ---------- Lifecycle wiring ----------
  function watchMutations() {
    if (observer) return;
    if (!document.body) return;

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
