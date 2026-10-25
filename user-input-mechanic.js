// user-input-mechanic.js
// DrawController stores every stroke as an array of points.
// It owns all the drawing logic for the user input mechanic.

class DrawController {
  constructor() {
    this.strokes = [];       // array of finished strokes
    this.current = null;     // stroke being drawn right now
    this.tool = "pencil";    // current tool: pencil, pen or marker
    this.hue = 180;          // current colour (HSB hue)
    this.lastErase = null;   // last erase position, used to erase continuously
    this.pointCount = 0;     // number of points on the canvas, kept for the HUD
    this.grab = null;        // the stroke being dragged by the hand tool
  }

  // called when the left mouse button is pressed
  startStroke(x, y) {
    if (glassCollision(x, y)) return; // strokes cannot start on the glass
    if (tapSound) tapSound.play();
    // size is stored once here so later size changes never affect this stroke
    this.current = { pts: [{ x, y }], tool: this.tool, hue: this.hue, size: BRUSH[this.tool].size };
  }

  // called while the mouse is dragged
  // adds interpolated points so lines stay continuous
  addPoint(x, y) {
    if (!this.current) return;
    if (glassCollision(x, y)) return; // strokes cannot pass through the glass
    const pts = this.current.pts;
    const last = pts[pts.length - 1];
    const n = Math.ceil(dist(last.x, last.y, x, y) / 2);
    const j = BRUSH[this.tool].jitter; // jitter makes pencil strokes look rough
    for (let i = 1; i <= n; i++) {
      let px = last.x + (x - last.x) * i / n;
      let py = last.y + (y - last.y) * i / n;
      // every interpolated point is checked: the stroke stops at the glass
      if (glassCollision(px, py)) break;
      if (j > 0) {
        px += random(-j, j);
        py += random(-j, j);
      }
      pts.push({ x: px, y: py });
    }
    this.pointCount += n;
  }

  // called when the mouse is released: save the current stroke
  endStroke() {
    if (this.current) {
      this.strokes.push(this.current);
      this.current = null;
    }
  }

  // Ctrl+Z: cancel a stroke in progress, otherwise drop the last finished stroke
  undo() {
    if (this.current) {
      this.current = null;
      return;
    }
    if (this.strokes.length > 0) {
      const s = this.strokes.pop();
      // pointCount counts interpolated points, which is pts.length minus the first
      this.pointCount = Math.max(0, this.pointCount - (s.pts.length - 1));
    }
  }

  // hand tool: pick the topmost stroke close to the press position
  grabStroke(x, y) {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i];
      for (const p of s.pts) {
        if (dist(p.x, p.y, x, y) < 25) {
          this.grab = { stroke: s, lastX: x, lastY: y };
          if (tapSound) tapSound.play();
          return;
        }
      }
    }
  }

  // hand tool: move every point of the grabbed stroke.
  // the glass shape blocks the stroke
  grabDrag(x, y) {
    if (!this.grab) return;
    let dx = x - this.grab.lastX;
    let dy = y - this.grab.lastY;
    // walk every point's full trajectory in small steps and stop the whole
    // stroke at the first step that would hit the glass, so a grabbed stroke
    // can never be dragged through the glass
    let t = 1;
    const pts = this.grab.stroke.pts;
    // high-res image-domain scan of every point's trajectory; the segment
    // midpoints are tested too so no gap can slip through a glass line
    for (const p of pts) {
      const h = firstGlassHit(p.x, p.y, p.x + dx, p.y + dy);
      if (h === 0) { t = 0; break; } // a point is sitting on the glass: frozen
      if (h > 0 && h < t) t = h;
    }
    if (t > 0) {
      for (let i = 0; i < pts.length - 1; i++) {
        const mx2 = (pts[i].x + pts[i + 1].x) / 2;
        const my2 = (pts[i].y + pts[i + 1].y) / 2;
        const h = firstGlassHit(mx2, my2, mx2 + dx, my2 + dy);
        if (h === 0) { t = 0; break; }
        if (h > 0 && h < t) t = h;
      }
    }
    dx *= t;
    dy *= t;
    for (const p of this.grab.stroke.pts) {
      p.x += dx;
      p.y += dy;
    }
    this.grab.lastX = x;
    this.grab.lastY = y;
  }

  // hand tool: release the grabbed stroke
  grabRelease() {
    this.grab = null;
  }

  // switches tool by name ("pencil", "pen" or "marker"), used by the toolbar icons
  switchTool(k) {
    if (clickSound) clickSound.play();
    switch (k) {
      case "pencil": this.tool = "pencil"; break;
      case "pen": this.tool = "pen"; break;
      case "marker": this.tool = "marker"; break;
      case "hand": this.tool = "hand"; break;
    }
  }

  // key 1 and key 2 make the current brush thinner and thicker
  adjustSize(delta) {
    const b = BRUSH[this.tool];
    b.size = constrain(b.size + delta, 2, 30);
  }

  // scroll wheel cycles the hue
  // only the hue changes, so the colour moves smoothly around the rainbow
  cycleColour(delta) {
    this.hue = (this.hue + delta * 0.1 + 360) % 360;
  }

  // right click removes every point close to (x, y)
  eraseClick(x, y) {
    this.eraseRadius(x, y);
    this.lastErase = { x, y };
  }

  // right drag removes points continuously along the path
  eraseDrag(x, y) {
    // [OUT OF SCOPE] condition ? a : b is the ternary operator, a short if/else
    // that returns a value (a when true, b when false).
    const sx = this.lastErase ? this.lastErase.x : x;
    const sy = this.lastErase ? this.lastErase.y : y;
    const n = Math.max(1, Math.ceil(dist(sx, sy, x, y) / 5));
    for (let i = 1; i <= n; i++) {
      this.eraseRadius(sx + (x - sx) * i / n, sy + (y - sy) * i / n);
    }
    this.lastErase = { x, y };
  }

  // removes points whose distance from (x, y) is smaller than the radius
  eraseRadius(x, y) {
    for (const s of this.strokes) {
      const before = s.pts.length;
      // keep only points farther than the erase radius
      const kept = [];
      for (const p of s.pts) {
        if (dist(x, y, p.x, p.y) > 40) kept.push(p);
      }
      s.pts = kept;
      this.pointCount -= before - s.pts.length;
    }
    // drop strokes that no longer have any points
    const keptStrokes = [];
    for (const s of this.strokes) {
      if (s.pts.length > 0) keptStrokes.push(s);
    }
    this.strokes = keptStrokes;
  }

  // output for Yufei's mechanic: every point with colour and brush size
  exportInputPoints() {
    const pts = [];
    for (const s of this.strokes) {
      for (const p of s.pts) {
        pts.push({ x: p.x, y: p.y, colour: s.hue, brushSize: s.size, tool: s.tool });
      }
    }
    return pts;
  }

  // output for Milli's mechanic: is the user dragging right now, and where
  getDragState() {
    const last = this.current ? this.current.pts[this.current.pts.length - 1] : null;
    return {
      isDragging: this.current !== null,
      x: last ? last.x : 0,
      y: last ? last.y : 0
    };
  }

  // draw everything, called from sketch.js every frame
  render() {
    for (const s of this.strokes) this.drawStroke(s, 1);
    if (this.current) this.drawStroke(this.current, 0.6);
    this.drawHover();
    this.drawUI();
  }

  // draws one stroke: lines between points plus dots on every point
  drawStroke(s, fade) {
    const b = BRUSH[s.tool];
    // keep the size from when the stroke was drawn
    let size;
    if (s.size !== undefined) size = s.size;
    else size = b.size;
    // [OUT OF SCOPE] push/pop save and restore style; strokeJoin/strokeCap set
    // the corners and line ends.
    push();
    stroke(s.hue, 80, 90, fade * 100 * b.alpha);
    strokeWeight(size);
    strokeJoin(ROUND);
    if (b.cap === "square") strokeCap(SQUARE);
    else strokeCap(ROUND);
    noFill();
    for (let i = 1; i < s.pts.length; i++) {
      const a = s.pts[i - 1];
      const c = s.pts[i];
      if (dist(a.x, a.y, c.x, c.y) > 15) continue; // erased gap: do not reconnect
      line(a.x, a.y, c.x, c.y);
    }
    noStroke();
    fill(s.hue, 80, 90, fade * 100 * b.alpha);
    for (const p of s.pts) {
      if (b.cap === "square") {
        // [OUT OF SCOPE] rectMode(CENTER) draws rects from their centre.
        rectMode(CENTER);
        rect(p.x, p.y, size, size);
      } else {
        circle(p.x, p.y, size);
      }
    }
    pop();
  }

  // small preview near the cursor: current colour, or erase range
  drawHover() {
    push();
    if (this.tool === "hand") { pop(); return; } // hand tool has no colour preview
    if (mouseIsPressed && mouseButton === RIGHT) {
      noFill();
      stroke(0, 0, 100, 70);
      circle(mouseX, mouseY, 80);
      pop();
      return; // erase range
    }
    // do not draw the colour preview over the left toolbar,
    // otherwise it looks like another icon is being selected
    if (mouseX < 130 && mouseY > 100 && mouseY < 890) {
      pop();
      return;
    }
    const hx = constrain(mouseX + 20, 30, width - 30);
    const hy = constrain(mouseY - 20, 30, height - 30);
    fill(this.hue, 80, 90);
    noStroke();
    circle(hx, hy, 18);
    stroke(0, 0, 100);
    strokeWeight(2);
    noFill();
    circle(hx, hy, 18);
    pop();
  }

  // HUD: current colour, tool name, hue value and point count
  drawUI() {
    push();
    fill(this.hue, 80, 90);
    noStroke();
    circle(40, 40, 40);
    fill(0, 0, 100);
    noStroke();
    // [OUT OF SCOPE] textSize/text draw the HUD.
    textSize(16);
    text("Tool: " + this.tool, 70, 30);
    text("Hue: " + Math.round(this.hue), 70, 52);
    if (this.tool === "hand") text("Size: -", 70, 74);
    else text("Size: " + BRUSH[this.tool].size, 70, 74);
    pop();
  }
}

// brush settings: size, opacity and cap shape for each tool
const BRUSH = {
  pencil: { size: 3,  alpha: 0.90, cap: "round",  jitter: 1.5 },
  pen:    { size: 7,  alpha: 0.75, cap: "round",  jitter: 0.5 },
  marker: { size: 16, alpha: 0.30, cap: "square", jitter: 0   },
  hand:   { size: 0,  alpha: 1,    cap: "round",  jitter: 0   } // placeholder, hand draws nothing
};