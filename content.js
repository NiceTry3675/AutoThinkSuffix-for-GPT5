// Think Hard Suffix — content script (MV3)
// Appends a selected suffix (default: " think harder") to AI chat messages at send-time, once per message.
// Privacy: no logging, no network requests, no data exfiltration.

(function () {
  'use strict';

  // Supported suffixes; user selects one in popup
  const SUPPORTED_SUFFIXES = [' think harder', ' think longer'];
  let currentSuffix = SUPPORTED_SUFFIXES[0]; // default: think harder
  const TRAILING_CHARS_REGEX = /[\s\u00A0!-/:-@\[-`{-~]+$/;

  let enabled = true;
  let attached = new WeakSet();
  let lastProgrammaticClick = 0; // kept for compatibility; no longer used

  // Initialize from storage
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
    chrome.storage.sync.get({ enabled: true, suffix: currentSuffix }, (res) => {
      enabled = !!res.enabled;
      if (typeof res.suffix === 'string' && SUPPORTED_SUFFIXES.includes(res.suffix)) {
        currentSuffix = res.suffix;
      }
      enableOrDisable(enabled);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.enabled) {
        enabled = !!changes.enabled.newValue;
        enableOrDisable(enabled);
      }
      if (area === 'sync' && changes.suffix) {
        const nv = changes.suffix.newValue;
        if (typeof nv === 'string' && SUPPORTED_SUFFIXES.includes(nv)) {
          currentSuffix = nv;
        }
      }
    });
  } else {
    // Fallback if storage not available
    enableOrDisable(true);
  }

  function enableOrDisable(on) {
    if (on) {
      startObservers();
      tryAttachNow();
    } else {
      // Nothing destructive; simply stop attaching new listeners
    }
  }

  function startObservers() {
    const observer = new MutationObserver(debounce(tryAttachNow, 200));
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });
  }

  function tryAttachNow() {
    if (!enabled) return;
    const targets = findPromptEditors();
    targets.forEach((t) => attachHandlers(t));
  }

  function attachHandlers(target) {
    if (!target || attached.has(target)) return;
    attached.add(target);

    // Keydown: intercept Enter vs Shift+Enter
    target.addEventListener('keydown', (e) => {
      if (!enabled) return;
      if (e.isComposing) return; // IME composition
      if (e.key !== 'Enter') return;
      if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return; // respect newlines/shortcuts

      const current = readValue(target);
      if (!hasSuffix(current)) {
        appendSuffixAtEnd(target);
      }
      // Do not prevent default; allow the site's native send to proceed
    }, true);

    // Click on Send button: use capture to update value before site handlers run
    const btn = findSendButtonNear(target) || findGlobalSendButton();
    if (btn && !attached.has(btn)) {
      attached.add(btn);
      btn.addEventListener('click', (e) => {
        if (!enabled) return;

        const current = readValue(target);
        if (!hasSuffix(current)) {
          appendSuffixAtEnd(target);
        }
        // Let the original click proceed naturally
      }, true); // capture phase
    }
  }

  // ————— Utilities —————
  function ensureSuffixed(text) {
    try {
      if (hasSuffix(text)) return text;
    } catch (_) {}
    return text + currentSuffix;
  }

  function hasSuffix(text) {
    if (!text) return false;
    const stripped = text.replace(TRAILING_CHARS_REGEX, '');
    return SUPPORTED_SUFFIXES.some((suf) => stripped.endsWith(suf));
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function dispatchSyntheticEnter(el) {
    try {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    } catch (_) {}
  }

  function findPromptEditors() {
    const results = new Set();
    // Preferred selector
    qsa('textarea[data-testid="prompt-textarea"]').forEach((el) => results.add(el));
    // Fallbacks
    qsa('textarea[placeholder*="Send a message" i]').forEach((el) => results.add(el));
    qsa('textarea[aria-label*="message" i]').forEach((el) => results.add(el));
    // Other platforms often use role=textbox with contenteditable
    qsa('[role="textbox"]').forEach((el) => results.add(el));
    // contenteditable fallback (if ChatGPT changes input type)
    qsa('[contenteditable="true"]').forEach((el) => {
      // Heuristic: likely prompt editor if it's visible and relatively large
      if (isLikelyEditor(el)) results.add(el);
    });
    return Array.from(results);
  }

  function findSendButtonNear(inputEl) {
    // Search within nearest form or container
    let root = inputEl.closest('form');
    if (!root) root = inputEl.closest('main,div,section,article') || document.body;
    return (
      root.querySelector('button[data-testid="send-button"]') ||
      root.querySelector('button[aria-label*="send" i]') ||
      root.querySelector('button[aria-label*="submit" i]') ||
      root.querySelector('button[title*="send" i]') ||
      root.querySelector('div[role="button"][aria-label*="send" i]') ||
      root.querySelector('button[type="submit"]') ||
      null
    );
  }

  function findGlobalSendButton() {
    return (
      document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button[aria-label*="send" i]') ||
      document.querySelector('button[aria-label*="submit" i]') ||
      document.querySelector('button[title*="send" i]') ||
      document.querySelector('div[role="button"][aria-label*="send" i]') ||
      document.querySelector('button[type="submit"]') ||
      null
    );
  }

  function isLikelyEditor(el) {
    const rect = el.getBoundingClientRect();
    const visible = rect.width > 150 && rect.height > 20;
    return visible && !el.getAttribute('role');
  }

  function readValue(el) {
    if ('value' in el) return el.value;
    if (el.isContentEditable) return el.textContent || '';
    return '';
  }

  function writeValue(el, val) {
    if ('value' in el) {
      // React-friendly setter for textarea/input
      const proto = el.constructor && el.constructor.prototype;
      const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      const htmlSetter = window.HTMLTextAreaElement && Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      const inputSetter = window.HTMLInputElement && Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      const set = setter || htmlSetter || inputSetter;
      if (set) set.call(el, val);
      else el.value = val;
      // Dispatch input event to sync React state
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (el.isContentEditable) {
      el.textContent = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function appendSuffixAtEnd(el) {
    if ('value' in el) {
      try {
        // Prefer setRangeText to avoid wiping selection or layout
        const pos = el.value.length;
        if (typeof el.setRangeText === 'function') {
          el.setRangeText(currentSuffix, pos, pos, 'end');
        } else {
          const proto = el.constructor && el.constructor.prototype;
          const setter = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          const htmlSetter = window.HTMLTextAreaElement && Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
          const inputSetter = window.HTMLInputElement && Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          const set = setter || htmlSetter || inputSetter;
          if (set) set.call(el, (el.value || '') + currentSuffix);
          else el.value = (el.value || '') + currentSuffix;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      } catch (_) {}
    }

    // contenteditable/role=textbox fallback
    try {
      el.focus();
      const sel = window.getSelection && window.getSelection();
      if (sel && document.createRange) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      let ok = false;
      try {
        if (document.execCommand) ok = document.execCommand('insertText', false, currentSuffix);
      } catch (_) {}
      if (!ok) {
        el.textContent = (el.textContent || '') + currentSuffix;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (_) {}
  }

  function qsa(sel, ctx = document) {
    return Array.from(ctx.querySelectorAll(sel));
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), wait);
    };
  }
})();
