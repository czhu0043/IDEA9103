// sketch.js
// Global state: one DrawController instance for the whole sketch.
let ctrl;

// floating colour glows for the colourful black background
let glows = [];

// small blurred layer for the glows: blur runs on 1/16 of the pixels
let glowLayer;

// background glass split into two layers:
// back layer sits under the strokes, front layer covers them
let glassBackImg, glassFrontImg;

// glass collision image: its visible (alpha) area is the glass shape used
// to block strokes from entering the glass
let glassCollisionImg;

// horizontal offset of the glass: starts off-screen right and slides in
let glassOffsetX;

// tilt angle of the glass while it slides in, eases back to upright
let glassAngle;

// tool icons for the left toolbar (normal + highlighted versions)
let iconPencil, iconPen, iconMarker, iconHand;
let iconPencilActive, iconPenActive, iconMarkerActive, iconHandActive;
let toolIcons = [];

// the door screen images: closed bar door and its open version
let doorImg;
let doorOpenImg;
let doorOpen = 0; // 0 = closed, 1 = hovered open

// audio: background music plus UI sound effects
let bgMusic, clickSound, tapSound, doorOpenSound, doorCloseSound, glassSlideSound, glassLandSound;
let audioStarted = false; // the browser unlocks audio after the first click

// scene flow: the door screen hides the sketch until the user clicks,
// which unlocks the browser audio and starts the glass animation
let scene = "door";
// entry timeline: after clicking the door, it opens, then closes, then a
// black cover fades in and the glass slides in invisibly, settling with
// a sound before the cover fades out. All times are ms after the click.
let enterT0 = 0;
let enterStarted = false;
let closeSounded = false, slideSounded = false, landSounded = false;
let slideAnimStarted = false; // glass moves (off-screen) before the sound starts
let landT = 0;
let maxIrisR; // largest visible circle radius (screen centre to corners)
const T_FADE = 300;         // iris close/open duration
const T_BLACK_FULL = 300;   // iris fully closed right after the click
const T_CLOSE_START = 1100; // open sound (1.1s) done, close sound begins
const T_OPEN_START = 1850;  // close sound (0.75s) done, iris begins opening

function preload() {
  glassBackImg = loadImage("assets/glass-back.png");
  glassFrontImg = loadImage("assets/glass-front.png");
  glassCollisionImg = loadImage("assets/glass-collision.png");
  iconPencil = loadImage("assets/icon-pencil.png");
  iconPen = loadImage("assets/icon-pen.png");
  iconMarker = loadImage("assets/icon-marker.png");
  iconPencilActive = loadImage("assets/icon-pencil-active.png");
  iconPenActive = loadImage("assets/icon-pen-active.png");
  iconMarkerActive = loadImage("assets/icon-marker-active.png");
  iconHand = loadImage("assets/icon-hand.png");
  iconHandActive = loadImage("assets/icon-hand-active.png");
  doorImg = loadImage("assets/door.png");
  doorOpenImg = loadImage("assets/door-open.png");
  bgMusic = loadSound("assets/audio/bg-music.wav");
  clickSound = loadSound("assets/audio/sfx-click.wav");
  tapSound = loadSound("assets/audio/sfx-tap.wav");
  doorOpenSound = loadSound("assets/audio/sfx-door-open.wav");
  doorCloseSound = loadSound("assets/audio/sfx-door-close.wav");
  glassSlideSound = loadSound("assets/audio/sfx-glass-slide.wav");
  glassLandSound = loadSound("assets/audio/sfx-glass-land.wav");
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  glassOffsetX = width; // the glass starts fully off-screen to the right
  maxIrisR = Math.sqrt((width / 2) * (width / 2) + (height / 2) * (height / 2));
  glassAngle = -0.35;   // tilted to the left (about -20 degrees) at the start
  // [OUT OF SCOPE] createGraphics makes a small off-screen canvas. The glows are
  // drawn and blurred there (cheap), then stretched onto the main canvas.
  glowLayer = createGraphics(width / 4, height / 4);
  glowLayer.colorMode(HSB, 360, 100, 100);
  colorMode(HSB, 360, 100, 100);
  ctrl = new DrawController();
  textFont("Calibri");
  // [OUT OF SCOPE] Stop the browser's right-click menu so the right mouse
  // button can be used to erase.
  document.querySelector("canvas").addEventListener("contextmenu", function (e) { e.preventDefault(); });
  // create the background colour glows
  for (let i = 0; i < 16; i++) {
    glows.push({
      x: random(width),
      y: random(height),
      r: random(140, 320),
      hue: random(360),
      vx: random(-0.3, 0.3),
      vy: random(-0.3, 0.3)
    });
  }
  // build the left toolbar with the three tool icons
  const size = 160;
  const x = 32;
  const yTop = 190;
  toolIcons.push({ img: iconPencil, activeImg: iconPencilActive, tool: "pencil", x, y: yTop, size });
  toolIcons.push({ img: iconPen, activeImg: iconPenActive, tool: "pen", x, y: yTop + 180, size });
  toolIcons.push({ img: iconMarker, activeImg: iconMarkerActive, tool: "marker", x, y: yTop + 360, size });
  toolIcons.push({ img: iconHand, activeImg: iconHandActive, tool: "hand", x, y: yTop + 540, size });
  // shrink the door images once so the per-frame draw stays fast
  const doorTargetW = Math.min(720, windowWidth * 0.46);
  if (doorImg.width > doorTargetW) {
    // [OUT OF SCOPE] image.resize() shrinks images once so drawing stays fast.
    doorImg.resize(doorTargetW, doorTargetW * doorImg.height / doorImg.width);
  }
  if (doorOpenImg.width > doorTargetW) {
    doorOpenImg.resize(doorTargetW, doorTargetW * doorOpenImg.height / doorOpenImg.width);
  }
  // shrink the glass images to ~1.25x display height (they are drawn near full-screen)
  const glassH = Math.ceil(windowHeight * 1.25);
  for (const g of [glassBackImg, glassFrontImg, glassCollisionImg]) {
    if (g.height > glassH) g.resize(Math.ceil(glassH * g.width / g.height), glassH);
  }
  // shrink the toolbar icons to 2x their on-screen size
  for (const ic of toolIcons) {
    if (ic.img.width > 320) ic.img.resize(320, Math.ceil(320 * ic.img.height / ic.img.width));
    if (ic.activeImg.width > 320) ic.activeImg.resize(320, Math.ceil(320 * ic.activeImg.height / ic.activeImg.width));
  }
  // cache the collision image pixels once for fast per-frame collision tests
  // [OUT OF SCOPE] loadPixels() fills the pixels[] array so collision tests can
  // read the alpha channel directly.
  glassCollisionImg.loadPixels();
}

function draw() {
  background(0, 0, 6); // near black base
  drawGlows();
  // paste the blurred glow layer up to full size
  image(glowLayer, 0, 0, width, height);
  if (scene === "door") {
    drawDoor();
    updateEnterTimeline();
    return;
  }
  // "intro" renders the scene under a fading black cover; "main" is interactive
  updateGlassSlide();
  drawGlassBack();
  ctrl.render();
  drawGlassFront();
  drawToolIcons();
  if (scene === "intro") updateEnterTimeline();
}

// moves the glows, draws them into the small layer and blurs it there:
// blurring a quarter-size layer every frame is much cheaper than
// blurring the full canvas
function drawGlows() {
  const s = 4; // downscale factor
  glowLayer.clear(); // [OUT OF SCOPE] clear() empties the off-screen layer
  for (const g of glows) {
    g.x += g.vx;
    g.y += g.vy;
    if (g.x < 0 || g.x > width)  g.vx *= -1;
    if (g.y < 0 || g.y > height) g.vy *= -1;
    glowLayer.noStroke();
    glowLayer.fill(g.hue, 50, 25, 6); // very low opacity colour
    glowLayer.circle(g.x / s, g.y / s, (g.r * 2) / s);
  }
  // [OUT OF SCOPE] filter(BLUR) blurs the small layer.
  glowLayer.filter(BLUR, 20); // cheap: only 1/16 of the full pixels
}

// drives the entry timeline: door close, black fade in/out, slide and
// landing sounds, and finally flips the scene to interactive "main"
function updateEnterTimeline() {
  if (!enterStarted) return; // timeline only runs after the door click
  const t = millis() - enterT0;
  // swap from the door screen to the scene immediately on the click
  if (scene === "door") scene = "intro";
  if (scene !== "intro") return;
  let visR; // radius of the visible circular opening
  if (t < T_BLACK_FULL) {
    // iris closing straight away: the opening shrinks to the centre
    visR = maxIrisR * (1 - constrain(t / T_FADE, 0, 1));
  } else {
    // fully black: wait for the open sound, then play the close sound
    if (!closeSounded && t >= T_CLOSE_START) {
      doorCloseSound.play();
      closeSounded = true;
    }
    if (t < T_OPEN_START) {
      visR = 0; // hold black while the door sounds play
    } else {
      // iris opening only after the close sound has finished
      const p = constrain((t - T_OPEN_START) / T_FADE, 0, 1);
      visR = maxIrisR * p;
      // under the cover, glide the glass from off-screen toward the right edge
      const r = getGlassRect();
      if (!slideAnimStarted) {
        glassOffsetX = width + (r.x - width) * p;
      }
      // start the sound a little early so its attack lands as the glass appears
      if (!slideSounded && p >= 0.9) {
        glassSlideSound.play();
        slideSounded = true;
      }
      if (p >= 1) {
        // fully visible: release the easing slide into the centre
        slideAnimStarted = true;
        if (!landSounded && glassOffsetX <= 0.5 && abs(glassAngle) <= 0.01) {
          glassLandSound.play();
          bgMusic.loop();
          landSounded = true;
        }
        if (landSounded) scene = "main";
      }
    }
  }
  drawIris(visR);
}

// paints black everywhere outside a circular opening of radius visR:
// a huge black stroked circle, its inner edge forms the round mask
function drawIris(visR) {
  if (visR >= maxIrisR) return; // fully visible, nothing to cover
  push();
  noFill();
  stroke(0);
  strokeWeight(maxIrisR * 2);
  circle(width / 2, height / 2, 2 * (maxIrisR + visR));
  pop();
}

// slides the glass in from the right with easing:
// each frame it moves part of the remaining distance, so it is fast
// at first and slows down as it reaches its final position
function updateGlassSlide() {
  // [OUT OF SCOPE] lerp(a, b, t) moves a value toward b by fraction t each
  // frame (linear interpolation).
  // hold the glass off-screen while the cover is still blacking in
  if (scene === "intro" && !slideAnimStarted) return;
  // phase 1: slide in from the right while keeping the tilt
  if (glassOffsetX > 0.5) {
    glassOffsetX = lerp(glassOffsetX, 0, 0.16);
    return;
  }
  glassOffsetX = 0;
  // phase 2: the glass has stopped, now it straightens up
  if (abs(glassAngle) > 0.01) {
    glassAngle = lerp(glassAngle, 0, 0.4);
  } else {
    glassAngle = 0;
  }
}

// returns the position and size where the glass is drawn on the canvas
function getGlassRect() {
  const scale = 1.0;
  const h = height * scale;
  const w = h * (glassBackImg.width / glassBackImg.height);
  const x = (width - w) / 2;
  const y = (height - h) / 2 + 130;
  return { x, y, w, h };
}

// draws the back layer of the glass: the rear rim arc only
// sits under the strokes, so strokes can cover it
function drawGlassBack() {
  const r = getGlassRect();
  // [OUT OF SCOPE] push/pop save and restore drawing style; translate moves the
  // origin and rotate turns the canvas.
  // pivot at 11% width / 92.6% height of the glass (the marked point)
  push();
  translate(r.x + glassOffsetX + r.w * 0.11, r.y + r.h * 0.926);
  rotate(glassAngle);
  image(glassBackImg, -r.w * 0.11, -r.h * 0.926, r.w, r.h);
  pop();
}

// draws the front layer of the glass: the full cup line art
// sits over the strokes, so it covers strokes drawn inside the cup
function drawGlassFront() {
  const r = getGlassRect();
  // pivot at 11% width / 92.6% height of the glass (the marked point)
  push();
  translate(r.x + glassOffsetX + r.w * 0.11, r.y + r.h * 0.926);
  rotate(glassAngle);
  image(glassFrontImg, -r.w * 0.11, -r.h * 0.926, r.w, r.h);
  pop();
}

// returns true if the point (cx, cy) is inside the glass.
// it maps the canvas point onto the glass wall image, reads the pixel
// with get(), and checks its alpha channel: pixels with alpha above the
// threshold are inside the glass, transparent pixels are outside.
// rim band of the glass-back arc (the cup opening), cached in image coords
let rimYTop = -1;
let rimYBottom = -1;

// scans the glass-back image once and returns the vertical band of the rim
function getRimBand() {
  if (rimYTop >= 0) return { top: rimYTop, bottom: rimYBottom };
  if (!glassBackImg) return null;
  glassBackImg.loadPixels(); // [OUT OF SCOPE] pixels[] then holds the image
  const px = glassBackImg.pixels;
  const w = glassBackImg.width;
  const h = glassBackImg.height;
  let top = h, bottom = -1;
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (px[(y * w + x) * 4 + 3] > 8) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  rimYTop = top;
  rimYBottom = bottom;
  return { top, bottom };
}

// glass-wall check given image coordinates
function glassCollisionMap(mx, my) {
  if (!glassCollisionImg) return false;
  if (mx < 0 || my < 0 || mx >= glassCollisionImg.width || my >= glassCollisionImg.height) return false;
  // read from the cached pixel array instead of per-frame get()
  return glassCollisionImg.pixels[(my * glassCollisionImg.width + mx) * 4 + 3] > 8;
}

// maps a canvas point onto the collision image; true = the point hits the glass
function glassCollision(cx, cy) {
  if (!glassCollisionImg) return false; // safety fallback: no image, no collision
  if (glassOffsetX > 0.5 || abs(glassAngle) > 0.01) return false; // wait until the glass stops
  const r = getGlassRect();
  const x = r.x + glassOffsetX;
  const y = r.y;
  if (cx < x || cx > x + r.w || cy < y || cy > y + r.h) return false;
  const mx = floor((cx - x) / r.w * glassCollisionImg.width);
  const my = floor((cy - y) / r.h * glassCollisionImg.height);
  return glassCollisionMap(mx, my);
}

// scans the canvas segment (x0,y0)-(x1,y1) inside the collision image at
// 1px steps of the image domain. the image is much higher resolution than
// the canvas, so thin glass lines there are several pixels wide and can
// never be jumped over. returns the first hit fraction, or -1 if clear.
function firstGlassHit(x0, y0, x1, y1) {
  if (!glassCollisionImg) return -1;
  const r = getGlassRect();
  const ox = r.x + glassOffsetX;
  const oy = r.y;
  const W = glassCollisionImg.width, H = glassCollisionImg.height;
  const mx0 = (x0 - ox) / r.w * W;
  const my0 = (y0 - oy) / r.h * H;
  const dxm = (x1 - x0) / r.w * W;
  const dym = (y1 - y0) / r.h * H;
  // start position already inside the glass: cannot move at all
  const sx = floor(mx0), sy = floor(my0);
  if (sx >= 0 && sx < W && sy >= 0 && sy < H && glassCollisionMap(sx, sy)) return 0;
  const steps = Math.max(1, Math.ceil(Math.max(abs(dxm), abs(dym))));
  for (let st = 1; st <= steps; st++) {
    const f = st / steps;
    const mx = floor(mx0 + dxm * f);
    const my = floor(my0 + dym * f);
    if (mx < 0 || my < 0 || mx >= W || my >= H) continue;
    if (glassCollisionMap(mx, my)) return (st - 1) / steps; // stop just before the line
  }
  return -1;
}

// the opening "door" screen: hovering the mouse opens the two panels
// and reveals the glowing background, clicking enters the sketch
function getDoorRect() {
  // fit the door image, keeping its aspect ratio
  const maxH = height * 0.8;
  let dw = width * 0.46;
  let dh = dw * (doorImg.height / doorImg.width);
  if (dh > maxH) { dh = maxH; dw = dh / (doorImg.height / doorImg.width); }
  return { x: (width - dw) / 2, y: (height - dh) / 2, w: dw, h: dh };
}

function drawDoor() {
  const doorRect = getDoorRect();
  const dx = doorRect.x, dy = doorRect.y, dw = doorRect.w, dh = doorRect.h;
  let hovering = mouseX > dx && mouseX < dx + dw && mouseY > dy && mouseY < dy + dh;
  // once the door is clicked it stays open even if the mouse moves away
  if (enterStarted) hovering = true;
  // dim the background behind the closed door; while it is open the
  // doorway shows the real sketch background directly
  noStroke();
  // [OUT OF SCOPE] condition ? a : b is the ternary operator, a short if/else
  // that returns a value (a when true, b when false).
  fill(0, 0, 4, hovering ? 0 : 70);
  rect(0, 0, width, height);
  // hard switch: hovering shows the open door, otherwise the closed door
  if (hovering) {
    // mask: the real background is only visible inside the doorway frame
    // (doorway is 480-1340 x 550-2080 of the source), everything outside
    // the frame is painted back to the base colour
    const ox = dx + dw * (480 / 1832);
    const oy = dy + dh * (550 / 2288);
    const ow = dw * ((1340 - 480) / 1832);
    const oh = dh * ((2080 - 550) / 2288);
    noStroke();
    fill(0, 0, 6);
    rect(0, 0, width, oy);
    rect(0, oy, ox, oh);
    rect(ox + ow, oy, width - ox - ow, oh);
    rect(0, oy + oh, width, height - oy - oh);
    image(doorOpenImg, dx, dy, dw, dh);
  } else {
    image(doorImg, dx, dy, dw, dh);
  }
  // prompt below the door
  noStroke();
  fill(0, 0, 100);
  // [OUT OF SCOPE] textAlign/textSize/text draw the prompt.
  textAlign(CENTER, CENTER);
  textSize(30);
  text("CLICK TO ENTER", width / 2, dy + dh + 70);
  textAlign(LEFT, BASELINE);
}

// draws the three tool icons: the active tool uses its highlighted image
function drawToolIcons() {
  for (const ic of toolIcons) {
    const img = ic.tool === ctrl.tool ? ic.activeImg : ic.img;
    image(img, ic.x, ic.y, ic.size, ic.size);
  }
}

function mousePressed() {
  // clicking the door unlocks the audio and opens the sketch
  if (scene === "door") {
    const r = getDoorRect();
    const onDoor =
      mouseX >= r.x && mouseX <= r.x + r.w &&
      mouseY >= r.y && mouseY <= r.y + r.h;
    if (!onDoor) return; // clicking outside the door does nothing
    // [OUT OF SCOPE] userStartAudio() unlocks sound inside a user gesture,
    // because browsers block audio before the first click.
    userStartAudio();
    audioStarted = true;
    // start the entry timeline: open sound, close sound, iris opens
    enterT0 = millis();
    enterStarted = true;
    closeSounded = false;
    slideSounded = false;
    landSounded = false;
    slideAnimStarted = false;
    doorOpenSound.play();
    return;
  }
  // first click unlocks the browser audio and starts the background music
  if (!audioStarted) {
    userStartAudio();
    audioStarted = true;
    bgMusic.loop();
  }
  // clicking a toolbar icon switches the tool
  for (const ic of toolIcons) {
    if (mouseX > ic.x - 6 && mouseX < ic.x + ic.size + 6 &&
        mouseY > ic.y - 6 && mouseY < ic.y + ic.size + 6) {
      ctrl.switchTool(ic.tool);
      return;
    }
  }
  if (mouseButton === RIGHT) { ctrl.eraseClick(mouseX, mouseY); return; }
  if (ctrl.tool === "hand") ctrl.grabStroke(mouseX, mouseY);
  else ctrl.startStroke(mouseX, mouseY);
}

function mouseDragged() {
  if (mouseButton === RIGHT) { ctrl.eraseDrag(mouseX, mouseY); return; }
  if (ctrl.tool === "hand") ctrl.grabDrag(mouseX, mouseY);
  else ctrl.addPoint(mouseX, mouseY);
}

// [OUT OF SCOPE] mouseReleased fires when the button is let go; it pairs with
// mousePressed.
function mouseReleased() {
  if (ctrl.tool === "hand") ctrl.grabRelease();
  else ctrl.endStroke();
}

// [OUT OF SCOPE] mouseWheel fires on scroll; e.delta is the scroll amount,
// used here to cycle the colour.
function mouseWheel(e) {
  if (scene !== "door") ctrl.cycleColour(e.delta);
  return false;
}

// key 1 makes the brush thinner, key 2 makes it thicker
function keyPressed() {
  if (scene === "door") return;
  // Ctrl+Z (Cmd+Z on Mac) undoes the current or last stroke
  // [OUT OF SCOPE] keyCode is the key number (90 = Z) and keyIsDown checks a
  // modifier key; this implements Ctrl+Z / Cmd+Z to undo.
  if (scene === "main" && keyCode === 90 &&
      (keyIsDown(CONTROL) || keyIsDown(COMMAND))) {
    ctrl.undo();
    return;
  }
  if (key === "1") ctrl.adjustSize(-1);
  else if (key === "2") ctrl.adjustSize(1);
}

// keeps the canvas filling the window on resize
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  glowLayer.resizeCanvas(width / 4, height / 4);
  maxIrisR = Math.sqrt((width / 2) * (width / 2) + (height / 2) * (height / 2));
}
