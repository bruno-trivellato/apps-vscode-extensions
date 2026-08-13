// Fullscreen pan/zoom viewer for mermaid diagrams, shared by the reader and by
// edit mode. No `vscode` import: these are strings, so the generated page can be
// built and syntax-checked in plain Node (see test/webview-scripts.test.js).
//
// The two views find their diagrams very differently:
//
//   reader     it owns the DOM, so it wraps each <pre class="mermaid"> in a
//              .mermaid-wrap and drops a button inside the wrapper.
//
//   edit mode  it must not touch the DOM at all. Vditor renders diagrams by
//              replacing the innerHTML of .language-mermaid, and Lute reads that
//              same DOM back to rebuild the markdown that gets written to the
//              file. A wrapper element there risks corrupting the document, and
//              anything placed inside is destroyed on the next re-render. So it
//              gets one floating button in <body>, positioned over whichever
//              diagram is hovered.
//
// The modal itself is identical in both, and lives in <body> either way.
//
// NOTE: these strings are interpolated into a template literal by the caller, so
// they must not contain "${". The concatenation style below is deliberate.

// Modal, stage, toolbar and hint. Shared.
const MODAL_CSS = `
  .mermaid-modal {
    position: fixed; inset: 0; z-index: 9999;
    background: var(--vscode-editor-background, #1e1e1e);
    overflow: hidden;
  }
  .mermaid-modal.panning { cursor: grabbing; }
  .mermaid-stage { position: absolute; top: 0; left: 0; transform-origin: 0 0; }
  .mermaid-stage svg { max-width: none !important; height: auto; display: block; }
  .mermaid-toolbar {
    position: fixed; top: 14px; right: 14px; z-index: 10000;
    display: flex; gap: 6px;
  }
  .mermaid-toolbar button {
    background: var(--vscode-button-secondaryBackground, #3a3d41);
    color: var(--vscode-button-secondaryForeground, #fff);
    border: 1px solid var(--vscode-panel-border, #8884);
    border-radius: 6px; cursor: pointer;
    min-width: 34px; height: 30px; font-size: 15px; line-height: 1;
  }
  .mermaid-toolbar button:hover { background: var(--vscode-button-background, #0e639c); }
  .mermaid-hint {
    position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%);
    z-index: 10000; font-size: 12px; opacity: .6;
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background, #1e1e1e);
    padding: 4px 10px; border-radius: 6px;
    border: 1px solid var(--vscode-panel-border, #8884);
  }`;

// Reader only: the wrapper and the button that sits inside it.
const READER_WRAP_CSS = `
  .mermaid-wrap { position: relative; display: block; text-align: center; margin: 1em 0; }
  .mermaid-wrap svg { width: 100%; max-width: 100% !important; height: auto; }
  .mermaid-wrap .expand-btn {
    position: absolute; top: 8px; right: 8px;
    opacity: 0; transition: opacity .15s, background .15s;
    width: 26px; height: 26px; padding: 0;
    display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--vscode-editor-foreground, #888) 12%, transparent);
    color: var(--vscode-editor-foreground, #ccc);
    border: none; border-radius: 5px; cursor: pointer;
    font-size: 14px; line-height: 1;
  }
  .mermaid-wrap:hover .expand-btn { opacity: .55; }
  .mermaid-wrap .expand-btn:hover { opacity: 1; background: color-mix(in srgb, var(--vscode-editor-foreground, #888) 22%, transparent); }`;

// Edit mode only: one floating button, parked in <body>.
// z-index sits under the kebab menu (200) and over Vditor's toolbar (1) and its
// own fullscreen (90).
const HOVER_BTN_CSS = `
  .bmr-dgm-btn {
    position: fixed; z-index: 150; display: none;
    width: 26px; height: 26px; padding: 0;
    align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--vscode-editor-foreground, #888) 14%, transparent);
    color: var(--vscode-editor-foreground, #ccc);
    border: 1px solid var(--vscode-panel-border, #8884);
    border-radius: 5px; cursor: pointer;
    font-size: 14px; line-height: 1;
    opacity: .75; transition: opacity .15s, background .15s;
  }
  .bmr-dgm-btn.visible { display: flex; }
  .bmr-dgm-btn:hover { opacity: 1; background: color-mix(in srgb, var(--vscode-editor-foreground, #888) 26%, transparent); }`;

// window.bmrZoom.open(svgEl) / .isOpen(). The SVG is cloned, so whatever the
// host page does to the original afterwards cannot disturb the modal. That
// matters in edit mode, where Vditor re-renders the diagram as you type.
const ZOOM_JS = `
(function () {
  var open = false;
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function openFullscreen(svgEl) {
    if (open) return;
    open = true;
    var modal = document.createElement('div');
    modal.className = 'mermaid-modal';
    var stage = document.createElement('div');
    stage.className = 'mermaid-stage';
    stage.appendChild(svgEl.cloneNode(true));
    modal.appendChild(stage);

    var bar = document.createElement('div');
    bar.className = 'mermaid-toolbar';
    var mk = function (label, title, fn) {
      var b = document.createElement('button');
      b.textContent = label; b.title = title;
      b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
      bar.appendChild(b);
      return b;
    };
    modal.appendChild(bar);

    var hint = document.createElement('div');
    hint.className = 'mermaid-hint';
    hint.textContent = 'Two fingers or middle-drag to pan \\u00b7 pinch or \\u2318+scroll to zoom \\u00b7 Esc to close';
    modal.appendChild(hint);

    document.body.appendChild(modal);

    var scale = 1, tx = 0, ty = 0;
    var applyT = function () {
      stage.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    };

    function fit() {
      scale = 1; tx = 0; ty = 0; applyT();
      var svg = stage.querySelector('svg');
      if (!svg) return;
      var r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var W = modal.clientWidth, H = modal.clientHeight;
      var pad = 60;
      scale = clamp(Math.min((W - pad) / r.width, (H - pad) / r.height), 0.1, 4);
      tx = (W - r.width * scale) / 2;
      ty = (H - r.height * scale) / 2;
      applyT();
    }

    function zoomAt(mx, my, factor) {
      var ns = clamp(scale * factor, 0.1, 12);
      tx = mx - (mx - tx) * (ns / scale);
      ty = my - (my - ty) * (ns / scale);
      scale = ns; applyT();
    }

    mk('+', 'Zoom in', function () { var r = modal.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 1.25); });
    mk('\\u2212', 'Zoom out', function () { var r = modal.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, 0.8); });
    mk('\\u2922', 'Fit to screen', fit);
    mk('\\u2715', 'Close (Esc)', close);

    // Trackpad: two fingers pan, pinch zooms.
    //
    // The browser reports a pinch as a wheel event with ctrlKey set, even though
    // no key is held. That is the only signal separating a pinch from a plain
    // two-finger scroll, and it is what every canvas app keys off. Ctrl/Cmd +
    // wheel on a real mouse lands in the same branch, which is the conventional
    // zoom gesture there anyway.
    modal.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = modal.getBoundingClientRect();
      // deltaMode 1 is lines, 2 is pages; a mouse wheel often reports lines.
      var k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? modal.clientHeight : 1;
      if (e.ctrlKey || e.metaKey) {
        // Continuous factor, so a pinch feels proportional instead of stepped.
        // Clamped because one mouse-wheel notch can report a huge delta.
        var dy = clamp(e.deltaY * k, -60, 60);
        zoomAt(e.clientX - r.left, e.clientY - r.top, Math.pow(0.995, dy));
        return;
      }
      tx -= e.deltaX * k;
      ty -= e.deltaY * k;
      applyT();
    }, { passive: false });

    // middle button (wheel) hold + drag = pan; left button stays free to select
    var dragging = false, lx = 0, ly = 0;
    modal.addEventListener('mousedown', function (e) {
      if (e.button !== 1) return;
      if (e.target.closest('.mermaid-toolbar')) return;
      e.preventDefault();
      dragging = true; lx = e.clientX; ly = e.clientY;
      modal.classList.add('panning');
    });
    modal.addEventListener('auxclick', function (e) { if (e.button === 1) e.preventDefault(); });
    window.addEventListener('mousemove', onMove);
    function onMove(e) {
      if (!dragging) return;
      tx += e.clientX - lx; ty += e.clientY - ly;
      lx = e.clientX; ly = e.clientY; applyT();
    }
    window.addEventListener('mouseup', onUp);
    function onUp() { if (dragging) { dragging = false; modal.classList.remove('panning'); } }

    // Capture phase + stopPropagation: in edit mode Vditor and the double-Esc
    // handler are also listening for Escape, and closing the modal must not
    // also kick the editor back to preview.
    function onKey(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    }
    window.addEventListener('keydown', onKey, true);

    function close() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey, true);
      modal.remove();
      open = false;
    }

    fit();
  }

  window.bmrZoom = { open: openFullscreen, isOpen: function () { return open; } };
})();`;

// Edit mode wiring. Never mutates Vditor's DOM: it only reads bounding boxes.
const EDIT_HOVER_JS = `
(function () {
  var DIAGRAM = '.language-mermaid';
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bmr-dgm-btn';
  btn.title = 'Open fullscreen (pan + zoom)';
  btn.textContent = '\\u26F6';
  btn.setAttribute('contenteditable', 'false');
  document.body.appendChild(btn);

  var current = null;

  function svgOf(el) { return el ? el.querySelector('svg') : null; }

  function place() {
    if (!current || !current.isConnected || !svgOf(current)) { hide(); return; }
    var r = current.getBoundingClientRect();
    // Scrolled out of view, or Vditor turned the block back into editable
    // source (so it has no size worth pointing at).
    if (r.width < 40 || r.height < 40 || r.bottom < 0 || r.top > window.innerHeight) { hide(); return; }
    btn.style.top = (Math.max(r.top, 0) + 8) + 'px';
    btn.style.left = (r.right - 34) + 'px';
    btn.classList.add('visible');
  }

  function hide() { current = null; btn.classList.remove('visible'); }

  document.addEventListener('mouseover', function (e) {
    var t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (t === btn || t.closest('.bmr-dgm-btn')) return; // keep it up while aiming at it
    var el = t.closest(DIAGRAM);
    if (!el || !svgOf(el)) { hide(); return; }
    current = el;
    place();
  });

  // Keep the button glued to its diagram. Capture, so inner scrollers count too.
  window.addEventListener('scroll', function () { if (current) place(); }, true);
  window.addEventListener('resize', function () { if (current) place(); });

  // Never let the editor lose its selection to the button.
  btn.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var svg = svgOf(current);
    if (svg && window.bmrZoom) window.bmrZoom.open(svg);
  });
})();`;

module.exports = { MODAL_CSS, READER_WRAP_CSS, HOVER_BTN_CSS, ZOOM_JS, EDIT_HOVER_JS };
