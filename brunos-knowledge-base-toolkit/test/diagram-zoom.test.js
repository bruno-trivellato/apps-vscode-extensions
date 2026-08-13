// Runs the real viewer source against a minimal fake DOM, so the pan/zoom maths
// is actually exercised instead of grepped for. The webview is the only other
// place this code runs, and it is not something mocha can open.

const assert = require("assert");
const { ZOOM_JS } = require("../lib/diagram-zoom");

const SVG_W = 400;
const SVG_H = 300;
const VIEW_W = 1000;
const VIEW_H = 800;

function makeEl(tag) {
  const el = {
    tagName: tag,
    style: {},
    className: "",
    title: "",
    textContent: "",
    children: [],
    handlers: {},
    classList: {
      set: new Set(),
      add(c) { this.set.add(c); },
      remove(c) { this.set.delete(c); },
      contains(c) { return this.set.has(c); },
    },
    clientWidth: VIEW_W,
    clientHeight: VIEW_H,
    addEventListener(type, fn) { (el.handlers[type] = el.handlers[type] || []).push(fn); },
    removeEventListener(type, fn) {
      el.handlers[type] = (el.handlers[type] || []).filter((f) => f !== fn);
    },
    appendChild(c) { el.children.push(c); return c; },
    remove() { el.removed = true; },
    setAttribute() {},
    getBoundingClientRect: () => ({ top: 0, left: 0, width: VIEW_W, height: VIEW_H }),
    querySelector(sel) {
      const hit = (n) =>
        n.tagName === sel ? n : n.children.reduce((acc, c) => acc || hit(c), null);
      return el.children.reduce((acc, c) => acc || hit(c), null);
    },
    cloneNode() { return makeSvg(); },
  };
  return el;
}

function makeSvg() {
  const svg = makeEl("svg");
  svg.getBoundingClientRect = () => ({ top: 0, left: 0, width: SVG_W, height: SVG_H });
  return svg;
}

// Boot the viewer against fresh fakes and open it on one diagram.
function openViewer() {
  const body = makeEl("body");
  const document = { body, createElement: makeEl };
  const window = { addEventListener() {}, removeEventListener() {} };
  const zoom = new Function("window", "document", ZOOM_JS + "\nreturn window.bmrZoom;")(
    window,
    document
  );

  zoom.open(makeSvg());
  const modal = body.children[0];
  const stage = modal.children[0];
  const wheel = (e) => modal.handlers.wheel[0]({ preventDefault() {}, ...e });
  return { zoom, modal, stage, wheel, transform: () => parse(stage.style.transform) };
}

function parse(t) {
  const m = /translate\((-?[\d.]+)px,(-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(t);
  assert.ok(m, "unexpected transform: " + t);
  return { tx: +m[1], ty: +m[2], scale: +m[3] };
}

describe("diagram viewer", () => {
  it("fits the diagram to the viewport on open, centred", () => {
    const { transform } = openViewer();
    const t = transform();
    // 400x300 into 1000x800 with 60px padding → limited by width
    assert.strictEqual(t.scale, (VIEW_W - 60) / SVG_W);
    assert.strictEqual(t.tx, (VIEW_W - SVG_W * t.scale) / 2);
    assert.strictEqual(t.ty, (VIEW_H - SVG_H * t.scale) / 2);
  });

  describe("trackpad", () => {
    it("pans on a two-finger scroll instead of zooming", () => {
      const { wheel, transform } = openViewer();
      const before = transform();
      wheel({ deltaX: 30, deltaY: 50, deltaMode: 0, clientX: 500, clientY: 400 });
      const after = transform();
      assert.strictEqual(after.scale, before.scale, "a two-finger scroll must not zoom");
      assert.strictEqual(after.tx, before.tx - 30);
      assert.strictEqual(after.ty, before.ty - 50);
    });

    it("pans horizontally on its own", () => {
      const { wheel, transform } = openViewer();
      const before = transform();
      wheel({ deltaX: -25, deltaY: 0, deltaMode: 0, clientX: 500, clientY: 400 });
      const after = transform();
      assert.strictEqual(after.tx, before.tx + 25);
      assert.strictEqual(after.ty, before.ty);
    });

    it("zooms in on a pinch, which the browser reports as ctrlKey", () => {
      const { wheel, transform } = openViewer();
      const before = transform();
      wheel({ deltaX: 0, deltaY: -20, deltaMode: 0, ctrlKey: true, clientX: 500, clientY: 400 });
      const after = transform();
      assert.ok(after.scale > before.scale, "pinch out should zoom in");
    });

    it("zooms out on the opposite pinch", () => {
      const { wheel, transform } = openViewer();
      const before = transform();
      wheel({ deltaX: 0, deltaY: 20, deltaMode: 0, ctrlKey: true, clientX: 500, clientY: 400 });
      assert.ok(transform().scale < before.scale, "pinch in should zoom out");
    });

    it("keeps the point under the cursor fixed while pinching", () => {
      const { wheel, transform } = openViewer();
      const cx = 300, cy = 250;
      const b = transform();
      // where that screen point sits in diagram space before the zoom
      const px = (cx - b.tx) / b.scale;
      const py = (cy - b.ty) / b.scale;
      wheel({ deltaX: 0, deltaY: -30, deltaMode: 0, ctrlKey: true, clientX: cx, clientY: cy });
      const a = transform();
      assert.ok(Math.abs(px * a.scale + a.tx - cx) < 1e-6, "x drifted under the cursor");
      assert.ok(Math.abs(py * a.scale + a.ty - cy) < 1e-6, "y drifted under the cursor");
    });
  });

  describe("mouse", () => {
    it("treats ctrl/cmd + wheel as zoom", () => {
      for (const mod of ["ctrlKey", "metaKey"]) {
        const { wheel, transform } = openViewer();
        const before = transform();
        wheel({ deltaX: 0, deltaY: -100, deltaMode: 0, [mod]: true, clientX: 500, clientY: 400 });
        assert.ok(transform().scale > before.scale, mod + " + wheel should zoom");
      }
    });

    it("scales line-mode deltas up, so a wheel notch moves a sensible distance", () => {
      const { wheel, transform } = openViewer();
      const before = transform();
      wheel({ deltaX: 0, deltaY: 3, deltaMode: 1, clientX: 500, clientY: 400 });
      assert.strictEqual(transform().ty, before.ty - 48); // 3 lines * 16px
    });

    it("does not run away on one huge wheel notch", () => {
      const { wheel, transform } = openViewer();
      const before = transform();
      wheel({ deltaX: 0, deltaY: -100000, deltaMode: 0, ctrlKey: true, clientX: 500, clientY: 400 });
      const ratio = transform().scale / before.scale;
      assert.ok(ratio > 1 && ratio < 1.5, "a single notch should not teleport the zoom: " + ratio);
    });
  });

  it("clamps the zoom range", () => {
    const { wheel, transform } = openViewer();
    for (let i = 0; i < 400; i++) {
      wheel({ deltaX: 0, deltaY: -60, deltaMode: 0, ctrlKey: true, clientX: 500, clientY: 400 });
    }
    assert.ok(transform().scale <= 12, "zoom should cap at 12x");
    for (let i = 0; i < 800; i++) {
      wheel({ deltaX: 0, deltaY: 60, deltaMode: 0, ctrlKey: true, clientX: 500, clientY: 400 });
    }
    assert.ok(transform().scale >= 0.1, "zoom should floor at 0.1x");
  });

  it("reports whether it is open, and refuses to stack modals", () => {
    const { zoom, modal } = openViewer();
    assert.strictEqual(zoom.isOpen(), true);
    zoom.open(makeSvg());
    assert.strictEqual(modal.children.filter((c) => c.className === "mermaid-stage").length, 1);
  });
});
