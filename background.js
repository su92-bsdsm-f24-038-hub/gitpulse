/**
 * GitPulse — background.js (Polyglot Prompt Specialist)
 * Master language-agnostic AI auditor. Dynamically inspects code syntax
 * to detect language and generate optimized reviews for ANY framework.
 */

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

const PROMPTS = {
  short:
    "Provide a 2-sentence ultra-concise TL;DR summary of the following code/diff. " +
    "Be direct. No headers, no bullets, no preamble.",
  detailed:
    "You are a master polyglot software engineering auditor. You will receive source code " +
    "snippets. Do not assume or default to Swift. Inspect the code syntax dynamically to " +
    "determine if it is Python, JS/TS, C++, Java, HTML/CSS, Go, Rust, or any other language, " +
    "and instantly generate the neon markdown code review optimized for THAT specific language " +
    "framework and its idioms. Use EXACTLY these sections (each as a level-3 markdown header): " +
    "'### \uD83C\uDFAF TL;DR', '### \uD83D\uDEE0\uFE0F Key Changes', '### \u26A0\uFE0F Risks'. " +
    "Be specific, reference functions/methods and files. No prose outside headers.",
  security:
    "Act as a Senior Cyber Security Auditor. Do NOT assume Swift. Dynamically inspect code " +
    "syntax to identify the language being reviewed. Inspect this code/diff strictly for bugs, " +
    "vulnerabilities, leaked secrets, injection risks, unsafe deserialization, auth flaws, " +
    "performance issues, and memory safety concerns appropriate for the detected language. " +
    "Adapt your security analysis to the specific attack vectors and vulnerabilities of that " +
    "language (e.g., SQL injection for queries, XSS for web code, buffer overflows for C++, " +
    "null pointer dereferences for compiled languages). Use EXACTLY this section header: " +
    "'### \u26A0\uFE0F Security Risks'. Use bullets. No other text."
};

function buildMessages(mode, code, meta) {
  const systemPrompt = (PROMPTS[mode] || PROMPTS.detailed) +
    " Always respond in well-formatted Markdown. Do NOT wrap the entire response in a code block.";

  const user =
    `Repository / File: ${meta && meta.title ? meta.title : "unknown"}\n` +
    `URL: ${meta && meta.url ? meta.url : "n/a"}\n\n` +
    "```\n" + code + "\n```";

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: user }
  ];
}

function estimateTokens(text) {
  const chars = (text || "").length;
  return Math.max(1, Math.ceil(chars / 4));
}

async function getApiKey() {
  const { groq_api_key } = await chrome.storage.local.get("groq_api_key");
  return groq_api_key || "";
}

async function getMode() {
  const { gitpulse_mode } = await chrome.storage.local.get("gitpulse_mode");
  return gitpulse_mode || "detailed";
}

async function setLastSummary(payload) {
  await chrome.storage.local.set({ last_summary: payload });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      if (!message || message.type !== "GITPULSE_ANALYZE") {
        sendResponse({ ok: false, error: "Unknown message" });
        return;
      }

      const mode = await getMode();
      const apiKey = await getApiKey();

      if (!apiKey) {
        const err = "Missing Groq API key. Set it in the GitPulse dashboard.";
        await setLastSummary({ mode, error: err, ts: Date.now() });
        sendResponse({ ok: false, error: err });
        return;
      }

      const inputChars = (message.code || "").length;
      const inputTokens = estimateTokens(message.code);

      const body = {
        model: MODEL,
        temperature: mode === "security" ? 0.1 : 0.3,
        max_tokens: mode === "short" ? 220 : mode === "security" ? 900 : 1100,
        messages: buildMessages(mode, message.code, {
          title: message.title,
          url: message.url
        })
      };

      chrome.runtime.sendMessage({ type: "GITPULSE_STATUS", status: "thinking", mode }).catch(() => {});

      const res = await fetch(GROQ_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + apiKey
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const t = await res.text();
        const err = `Groq ${res.status}: ${t.slice(0, 240)}`;
        await setLastSummary({ mode, error: err, ts: Date.now() });
        sendResponse({ ok: false, error: err });
        return;
      }

      const data = await res.json();
      const summary =
        data &&
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content
          ? data.choices[0].message.content.trim()
          : "";

      const outputTokens =
        (data && data.usage && data.usage.completion_tokens) ||
        estimateTokens(summary);

      const payload = {
        ok: true,
        mode,
        summary,
        title: message.title,
        url: message.url,
        model: MODEL,
        ts: Date.now(),
        tokens: {
          input: inputTokens,
          output: outputTokens,
          total: inputTokens + outputTokens,
          inputChars
        }
      };

      await setLastSummary(payload);
      sendResponse({ ok: true });
    } catch (e) {
      const err = (e && e.message) || String(e);
      await setLastSummary({ error: err, ts: Date.now() });
      sendResponse({ ok: false, error: err });
    }
  })();

  return true;
});
