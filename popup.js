/**
 * GitPulse — popup.js
 * Wires the dashboard: persists mode + Groq key, shows loader on background
 * status, renders custom Markdown (high-contrast, neon-purple/pink),
 * computes & displays the token stat, exports the active summary to .md,
 * and exposes the GitHub repo link (TODO 6).
 */

(() => {
  "use strict";

  // GitPulse project metadata (TODO 6)
  const REPO_URL = "https://github.com/su92-bsdsm-f24-038-hub/gitpulse";
  const REPO_OWNER = "su92-bsdsm-f24-038-hub";
  const REPO_NAME  = "gitpulse";

  const $ = (id) => document.getElementById(id);
  const modeRow = $("modeRow");
  const apiKeyEl = $("apiKey");
  const saveKeyBtn = $("saveKeyBtn");
  const analyzeBtn = $("analyzeBtn");
  const summaryEl = $("summary");
  const loaderEl = $("loader");
  const statsEl = $("stats");
  const exportBtn = $("exportBtn");
  const repoLink = $("repoLink");

  // Wire the repo link to the canonical URL (defense-in-depth in case HTML
  // is served from cache without the new href).
  if (repoLink) {
    repoLink.setAttribute("href", REPO_URL);
    repoLink.setAttribute("target", "_blank");
    repoLink.setAttribute("rel", "noopener noreferrer");
  }

  // -------- Markdown renderer (minimal, high-contrast) --------
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);
  }

  function renderMarkdown(md) {
    if (!md) return "";
    let s = escapeHtml(md);

    // Fenced code blocks
    s = s.replace(/```([\s\S]*?)```/g, (_, code) => `<pre>${code}</pre>`);

    // Headers (###, ##, #)
    s = s.replace(/^###\s+(.*)$/gm, "<h3>$1</h3>");
    s = s.replace(/^##\s+(.*)$/gm, "<h3>$1</h3>");
    s = s.replace(/^#\s+(.*)$/gm, "<h3>$1</h3>");

    // Horizontal rules
    s = s.replace(/^\s*---\s*$/gm, "<hr/>");

    // Bold then italic
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

    // Inline code
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Unordered lists
    s = s.replace(/(?:^|\n)((?:\s*[-*]\s+.*\n?)+)/g, (m, block) => {
      const items = block
        .trim()
        .split(/\n/)
        .map((l) => l.replace(/^\s*[-*]\s+/, ""))
        .map((l) => `<li>${l}</li>`)
        .join("");
      return `\n<ul>${items}</ul>`;
    });

    // Paragraphs (split on double newlines)
    s = s
      .split(/\n{2,}/)
      .map((block) => {
        if (/^\s*<(h3|ul|pre|hr|ol)/.test(block)) return block;
        if (!block.trim()) return "";
        return `<p>${block.replace(/\n/g, "<br/>")}</p>`;
      })
      .join("\n");

    return s;
  }

  // -------- Persistence --------
  function loadAll() {
    chrome.storage.local.get(["gitpulse_mode", "groq_api_key", "last_summary"], (data) => {
      const mode = data.gitpulse_mode || "detailed";
      const inputs = modeRow.querySelectorAll("input[name=mode]");
      inputs.forEach((i) => { i.checked = i.value === mode; });
      apiKeyEl.value = data.groq_api_key || "";
      renderLastSummary(data.last_summary);
    });
  }

  function setMode(mode) {
    chrome.storage.local.set({ gitpulse_mode: mode });
  }

  saveKeyBtn.addEventListener("click", () => {
    const v = apiKeyEl.value.trim();
    chrome.storage.local.set({ groq_api_key: v }, () => {
      saveKeyBtn.textContent = v ? "\u2713 Saved" : "Cleared";
      setTimeout(() => (saveKeyBtn.textContent = "Save Key"), 1400);
    });
  });

  modeRow.addEventListener("change", (e) => {
    if (e.target && e.target.name === "mode") {
      setMode(e.target.value);
    }
  });

  // -------- Loader & live status --------
  function showLoader(on, text) {
    loaderEl.classList.toggle("on", !!on);
    if (text) loaderEl.querySelector(".loader-text").textContent = text;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "GITPULSE_STATUS") {
      if (msg.status === "thinking") {
        showLoader(true, `Thinking with llama-3.3-70b (${msg.mode || ""})...`);
      }
    }
  });

  // -------- Render last summary on open --------
  function renderLastSummary(payload) {
    if (!payload) return;

    if (payload.error) {
      summaryEl.innerHTML = `<div class="empty">&#x26A0;&#xFE0F; ${escapeHtml(payload.error)}</div>`;
      statsEl.textContent = "Estimated Cost: ~0 Tokens Processed";
      return;
    }

    if (payload.summary) {
      summaryEl.innerHTML = renderMarkdown(payload.summary);
    }

    const t = payload.tokens || {};
    const total = t.total || (t.input || 0) + (t.output || 0);
    statsEl.textContent = `Estimated Cost: ~${total.toLocaleString()} Tokens Processed`;
  }

  // Trigger a refresh when storage changes (e.g. background.js finished)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.last_summary) return;
    const ns = changes.last_summary.newValue;
    showLoader(false);
    if (ns) renderLastSummary(ns);
  });

  // -------- Export to Markdown --------
  function safeFileBase(name) {
    return (name || "gitpulse-summary")
      .replace(/[^\w\d-_. ]+/g, "")
      .trim()
      .slice(0, 80) || "gitpulse-summary";
  }

  exportBtn.addEventListener("click", () => {
    chrome.storage.local.get(["last_summary"], ({ last_summary }) => {
      if (!last_summary || !last_summary.summary) return;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const base = safeFileBase(
        (last_summary.title || "").replace(/\s+\-\s+.*$/, "").split("/").pop()
      );
      const filename = `${base}-${stamp}.md`;

      const header =
        `# GitPulse Summary\n\n` +
        `> Generated by [GitPulse](${REPO_URL}) \u2014 Elite AI code reviewer.\n\n` +
        `- **Mode:** ${last_summary.mode || "detailed"}\n` +
        `- **Model:** ${last_summary.model || "llama-3.3-70b-versatile"}\n` +
        `- **Source:** ${last_summary.url || "n/a"}\n` +
        `- **Extension:** [${REPO_OWNER}/${REPO_NAME}](${REPO_URL})\n` +
        `- **Generated:** ${new Date(last_summary.ts || Date.now()).toISOString()}\n\n---\n\n`;

      const body = header + last_summary.summary;
      const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    });
  });

  // -------- "Analyze" button: scrape current GitHub tab & send --------
  analyzeBtn.addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/github\.com/.test(tab.url || "")) {
      summaryEl.innerHTML = `<div class="empty">Open a GitHub file or PR diff first, then hit &#x26A1; Analyze.</div>`;
      return;
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
    } catch (e) {
      // Content script may already be injected; that's fine.
    }
    chrome.tabs.sendMessage(tab.id, { type: "GITPULSE_TRIGGER_FROM_POPUP" }, () => {
      void chrome.runtime.lastError; // suppress
    });
    showLoader(true, "Thinking with llama-3.3-70b...");
    analyzeBtn.disabled = true;
    setTimeout(() => (analyzeBtn.disabled = false), 4000);
  });

  // -------- Init --------
  loadAll();
})();