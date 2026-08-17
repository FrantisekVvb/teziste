(() => {
  const SVG_W = 311;
  const SVG_H = 310;

  const SHAPE_D =
    "M247.668 148.532L163.669 22.6651L104.133 113.921L32.9109 128.942L71.7213 227.303L204.455 273.132L247.668 148.532Z";

  const VERTICES = [
    [247.668, 148.532],
    [163.669, 22.6651],
    [104.133, 113.921],
    [32.9109, 128.942],
    [71.7213, 227.303],
    [204.455, 273.132],
  ];

  const HOLES = [
    [163.384, 44.7653],
    [231.986, 151.418],
    [195.787, 256.697],
    [81.4278, 215.856],
    [51.8553, 138.847],
    [112.068, 124.035],
  ];

  const SHAPE_SCALE = 0.7;
  const PEG = { x: 163.5, y: 44, r: 7 * SHAPE_SCALE };
  const HOOK_ATTACH = { x: PEG.x, y: PEG.y };

  const HOLE_R = 8;
  const SNAP = 14 * SHAPE_SCALE;
  const G = 1800;
  const DAMPING = 2.4;

  const scene = document.getElementById("scene");
  const worldGroup = document.getElementById("world");
  const shapeGroup = document.getElementById("shape-group");
  const shapeBody = document.getElementById("shape-body");
  const shapeStroke = document.getElementById("shape-stroke");
  const shapeClipPath = document.getElementById("shape-clip-path");
  const drawingsGroup = document.getElementById("drawings");
  const holesGroup = document.getElementById("holes");
  const hookGroup = document.getElementById("hook");
  const hookOverGroup = document.getElementById("hook-over");
  const holesClip = document.getElementById("holes-clip");
  const guessLayer = document.getElementById("guess-layer");
  const guessFeedback = document.getElementById("guess-feedback");
  const app = document.getElementById("app");
  const guessCmBtn = document.getElementById("tool-guess-cm");
  const pencilBtn = document.getElementById("tool-pencil");
  const clearDrawingsBtn = document.getElementById("clear-drawings-btn");
  const unhookBtn = document.getElementById("unhook-btn");

  const DRAW_MIN_DIST = 0.8;

  const centroid = polygonCentroid(VERTICES);

  const state = {
    width: 0,
    height: 0,
    worldScale: 1,
    worldX: 0,
    worldY: 0,
    tx: 0,
    ty: 0,
    angle: 0,
    omega: 0,
    hungIndex: -1,
    dragging: false,
    dragMode: null,
    grabLocal: null,
    nearIndex: -1,
    lastT: 0,
    placed: false,
    tool: "move",
    drawing: false,
    currentStroke: null,
    strokePoints: [],
    guessResult: null,
  };

  function circlePath(cx, cy, r) {
    return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
  }

  shapeBody.setAttribute(
    "d",
    SHAPE_D + HOLES.map(([x, y]) => circlePath(x, y, HOLE_R)).join("")
  );
  shapeStroke.setAttribute("d", SHAPE_D);
  shapeClipPath.setAttribute(
    "d",
    SHAPE_D + HOLES.map(([x, y]) => circlePath(x, y, HOLE_R)).join("")
  );
  shapeClipPath.setAttribute("fill-rule", "evenodd");

  HOLES.forEach((hole, index) => {
    const hit = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    hit.classList.add("hole-hit");
    hit.setAttribute("cx", hole[0]);
    hit.setAttribute("cy", hole[1]);
    hit.setAttribute("r", HOLE_R * 2.1);
    hit.dataset.index = String(index);

    const disk = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    disk.classList.add("hole-disk");
    disk.setAttribute("cx", hole[0]);
    disk.setAttribute("cy", hole[1]);
    disk.setAttribute("r", HOLE_R);
    disk.dataset.index = String(index);

    holesGroup.append(hit, disk);

    const clip = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    clip.setAttribute("r", HOLE_R * SHAPE_SCALE);
    clip.dataset.index = String(index);
    holesClip.append(clip);
  });

  function createPeg() {
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.classList.add("peg");
    circle.setAttribute("cx", PEG.x);
    circle.setAttribute("cy", PEG.y);
    circle.setAttribute("r", PEG.r);
    circle.setAttribute("fill", "#575756");
    return circle;
  }

  hookGroup.append(createPeg());
  hookOverGroup.append(createPeg());

  function polygonCentroid(verts) {
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < verts.length; i += 1) {
      const [x1, y1] = verts[i];
      const [x2, y2] = verts[(i + 1) % verts.length];
      const cross = x1 * y2 - x2 * y1;
      area += cross;
      cx += (x1 + x2) * cross;
      cy += (y1 + y2) * cross;
    }
    area *= 0.5;
    return { x: cx / (6 * area), y: cy / (6 * area) };
  }

  function pointInPolygon(x, y, verts) {
    let inside = false;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i, i += 1) {
      const xi = verts[i][0];
      const yi = verts[i][1];
      const xj = verts[j][0];
      const yj = verts[j][1];
      const intersect =
        yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function rotatePoint(x, y, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { x: c * x - s * y, y: s * x + c * y };
  }

  function localToWorld(x, y) {
    const p = rotatePoint(x * SHAPE_SCALE, y * SHAPE_SCALE, state.angle);
    return { x: state.tx + p.x, y: state.ty + p.y };
  }

  function worldToLocal(x, y) {
    const dx = x - state.tx;
    const dy = y - state.ty;
    const c = Math.cos(state.angle);
    const s = Math.sin(state.angle);
    return {
      x: (c * dx + s * dy) / SHAPE_SCALE,
      y: (-s * dx + c * dy) / SHAPE_SCALE,
    };
  }

  function pinToHook(holeIndex) {
    const hole = HOLES[holeIndex];
    const holeRot = rotatePoint(hole[0] * SHAPE_SCALE, hole[1] * SHAPE_SCALE, state.angle);
    state.tx = HOOK_ATTACH.x - holeRot.x;
    state.ty = HOOK_ATTACH.y - holeRot.y;
  }

  function hangAngleFor(holeIndex) {
    if (holeIndex === 0) return 0;
    const hole = HOLES[holeIndex];
    const vx = centroid.x - hole[0];
    const vy = centroid.y - hole[1];
    return Math.PI / 2 - Math.atan2(vy, vx);
  }

  function normalizeAngle(angle) {
    let a = angle;
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function nearestHoleToHook() {
    let best = -1;
    let bestDist = Infinity;
    HOLES.forEach((hole, index) => {
      const p = localToWorld(hole[0], hole[1]);
      const dist = Math.hypot(p.x - HOOK_ATTACH.x, p.y - HOOK_ATTACH.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    });
    return { index: best, dist: bestDist };
  }

  function pointerFromEvent(event) {
    const rect = scene.getBoundingClientRect();
    const sx = ((event.clientX - rect.left) / rect.width) * state.width;
    const sy = ((event.clientY - rect.top) / rect.height) * state.height;
    return {
      x: (sx - state.worldX) / state.worldScale,
      y: (sy - state.worldY) / state.worldScale,
    };
  }

  function pointOnShapeBody(x, y) {
    if (!pointInPolygon(x, y, VERTICES)) return false;
    for (let i = 0; i < HOLES.length; i += 1) {
      const hole = HOLES[i];
      if (Math.hypot(x - hole[0], y - hole[1]) <= HOLE_R) return false;
    }
    return true;
  }

  function setTool(tool) {
    if (tool !== "guess-cm") {
      clearGuessResult();
    }
    state.tool = tool;
    app.dataset.tool = tool;
    guessCmBtn.classList.toggle("is-active", tool === "guess-cm");
    guessCmBtn.setAttribute("aria-pressed", String(tool === "guess-cm"));
    pencilBtn.classList.toggle("is-active", tool === "pencil");
    pencilBtn.setAttribute("aria-pressed", String(tool === "pencil"));
  }

  function referenceGuessDistance() {
    const bounds = shapeBounds();
    return Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * SHAPE_SCALE * 0.45;
  }

  function guessAccuracyLabel(distance) {
    const ref = referenceGuessDistance();
    const score = Math.max(0, Math.round(100 - (distance / ref) * 100));
    let label = "Od těžiště jsi dost daleko.";
    if (distance <= ref * 0.12) label = "Výborně! Velmi přesný odhad.";
    else if (distance <= ref * 0.28) label = "Dobře, jsi docela blízko.";
    else if (distance <= ref * 0.5) label = "Už to není daleko.";
    return { score, label, ref };
  }

  function clearGuessResult() {
    state.guessResult = null;
    guessLayer.replaceChildren();
    guessLayer.hidden = true;
    guessFeedback.hidden = true;
    guessFeedback.textContent = "";
  }

  function submitGuess(guessWorld) {
    const actual = localToWorld(centroid.x, centroid.y);
    const distance = Math.hypot(guessWorld.x - actual.x, guessWorld.y - actual.y);
    const { score, label } = guessAccuracyLabel(distance);
    state.guessResult = {
      guessX: guessWorld.x,
      guessY: guessWorld.y,
      distance,
      score,
      label,
    };
    guessFeedback.innerHTML = `<strong>${label}</strong>Odchylka ${Math.round(distance)} px · přesnost ${score}&nbsp;%`;
    guessFeedback.hidden = false;
    updateGuessVisuals();
  }

  function createCross(x, y, className) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add(className);
    group.setAttribute("transform", `translate(${x} ${y})`);

    const size = 8;
    [[-size, 0, size, 0], [0, -size, 0, size]].forEach(([x1, y1, x2, y2]) => {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x1);
      line.setAttribute("y1", y1);
      line.setAttribute("x2", x2);
      line.setAttribute("y2", y2);
      group.append(line);
    });

    return group;
  }

  function updateGuessVisuals() {
    if (!state.guessResult || state.tool !== "guess-cm") {
      guessLayer.hidden = true;
      return;
    }

    const actual = localToWorld(centroid.x, centroid.y);
    const guess = state.guessResult;
    guessLayer.hidden = false;
    guessLayer.replaceChildren();

    guessLayer.append(createCross(guess.guessX, guess.guessY, "guess-cross"));
    guessLayer.append(createCross(actual.x, actual.y, "cm-cross"));
  }

  function startStroke(local) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.classList.add("drawing-stroke");
    path.setAttribute("d", `M${local.x} ${local.y}`);
    drawingsGroup.append(path);
    state.drawing = true;
    state.currentStroke = path;
    state.strokePoints = [{ x: local.x, y: local.y }];
    app.classList.add("is-drawing");
  }

  function continueStroke(local) {
    if (!state.drawing || !state.currentStroke) return;
    const last = state.strokePoints[state.strokePoints.length - 1];
    if (Math.hypot(local.x - last.x, local.y - last.y) < DRAW_MIN_DIST) return;
    state.strokePoints.push({ x: local.x, y: local.y });
    const d = state.strokePoints
      .map((point, index) => `${index === 0 ? "M" : "L"}${point.x} ${point.y}`)
      .join(" ");
    state.currentStroke.setAttribute("d", d);
  }

  function finishStroke() {
    state.drawing = false;
    state.currentStroke = null;
    state.strokePoints = [];
    app.classList.remove("is-drawing");
  }

  function clearDrawings() {
    drawingsGroup.replaceChildren();
    finishStroke();
  }

  function hitTest(local) {
    for (let i = 0; i < HOLES.length; i += 1) {
      const hole = HOLES[i];
      if (Math.hypot(local.x - hole[0], local.y - hole[1]) <= HOLE_R * 2.4) {
        return { kind: "hole", index: i };
      }
    }
    if (pointInPolygon(local.x, local.y, VERTICES)) {
      return { kind: "body" };
    }
    return null;
  }

  function layout() {
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    scene.setAttribute("viewBox", `0 0 ${state.width} ${state.height}`);

    state.worldScale =
      Math.min(state.width / SVG_W, state.height / SVG_H) * 0.88;
    state.worldX = (state.width - SVG_W * state.worldScale) / 2;
    state.worldY = (state.height - SVG_H * state.worldScale) / 2;

    worldGroup.setAttribute(
      "transform",
      `translate(${state.worldX} ${state.worldY}) scale(${state.worldScale})`
    );

    if (state.hungIndex >= 0) {
      pinToHook(state.hungIndex);
    } else if (!state.placed && !state.dragging) {
      placeFreeCenter();
    }

    render();
  }

  function placeFreeCenter() {
    const bounds = shapeBounds();
    state.angle = (-40 * Math.PI) / 180;
    state.omega = 0;
    const mid = rotatePoint(
      ((bounds.minX + bounds.maxX) / 2) * SHAPE_SCALE,
      ((bounds.minY + bounds.maxY) / 2) * SHAPE_SCALE,
      state.angle
    );
    state.tx = SVG_W / 2 - mid.x;
    state.ty = SVG_H * 0.58 - mid.y;
    state.placed = true;
  }

  function shapeBounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    VERTICES.forEach(([x, y]) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });
    return { minX, minY, maxX, maxY };
  }

  function hangFrom(index, { settle = false } = {}) {
    state.hungIndex = index;
    state.omega = 0;
    if (settle) {
      state.angle = hangAngleFor(index);
    }
    pinToHook(index);
  }

  function unhook() {
    if (state.hungIndex < 0) return;
    state.hungIndex = -1;
    state.omega = 0;
  }

  function resetToDefault() {
    state.hungIndex = -1;
    state.omega = 0;
    state.dragging = false;
    state.dragMode = null;
    app.classList.remove("is-dragging");
    clearDrawings();
    clearGuessResult();
    setTool("move");
    placeFreeCenter();
    render();
  }

  function updateNearHole() {
    if (state.hungIndex >= 0) {
      state.nearIndex = state.hungIndex;
      return;
    }
    const nearest = nearestHoleToHook();
    state.nearIndex = nearest.dist < SNAP * 1.35 ? nearest.index : -1;
  }

  function render() {
    const deg = (state.angle * 180) / Math.PI;
    shapeGroup.setAttribute(
      "transform",
      `translate(${state.tx} ${state.ty}) rotate(${deg}) scale(${SHAPE_SCALE})`
    );

    holesClip.querySelectorAll("circle").forEach((clip) => {
      const hole = HOLES[Number(clip.dataset.index)];
      const world = localToWorld(hole[0], hole[1]);
      clip.setAttribute("cx", world.x);
      clip.setAttribute("cy", world.y);
    });

    updateGuessVisuals();
  }

  function step(t) {
    const now = t * 0.001;
    const dt = state.lastT ? Math.min(0.032, now - state.lastT) : 0.016;
    state.lastT = now;

    if (state.hungIndex >= 0 && !state.dragging) {
      const hole = HOLES[state.hungIndex];
      const target = hangAngleFor(state.hungIndex);
      const error = normalizeAngle(state.angle - target);
      const length = Math.max(
        20,
        Math.hypot(centroid.x - hole[0], centroid.y - hole[1]) * SHAPE_SCALE
      );
      state.omega += (-(G / length) * Math.sin(error) - DAMPING * state.omega) * dt;
      state.angle += state.omega * dt;
      if (Math.abs(error) < 0.003 && Math.abs(state.omega) < 0.02) {
        state.angle = target;
        state.omega = 0;
      }
      pinToHook(state.hungIndex);
    }

    updateNearHole();
    render();
    requestAnimationFrame(step);
  }

  function onPointerDown(event) {
    const pointer = pointerFromEvent(event);
    const local = worldToLocal(pointer.x, pointer.y);

    if (state.tool === "pencil") {
      if (!pointOnShapeBody(local.x, local.y)) return;
      event.preventDefault();
      scene.setPointerCapture(event.pointerId);
      startStroke(local);
      return;
    }

    if (state.tool === "guess-cm") {
      event.preventDefault();
      submitGuess(pointer);
      return;
    }

    const hit = hitTest(local);
    if (!hit) return;

    event.preventDefault();
    scene.setPointerCapture(event.pointerId);
    state.dragging = true;
    state.grabLocal = local;
    state.omega = 0;
    app.classList.add("is-dragging");

    const grabbingHungHole =
      state.hungIndex >= 0 &&
      hit.kind === "hole" &&
      hit.index === state.hungIndex;

    if (grabbingHungHole) {
      unhook();
      state.dragMode = "move";
    } else if (state.hungIndex >= 0) {
      state.dragMode = "swing";
    } else {
      state.dragMode = "move";
    }
  }

  function onPointerMove(event) {
    const pointer = pointerFromEvent(event);

    if (state.drawing) {
      const local = worldToLocal(pointer.x, pointer.y);
      if (pointOnShapeBody(local.x, local.y)) {
        continueStroke(local);
      }
      return;
    }

    if (!state.dragging) return;

    if (state.dragMode === "swing" && state.hungIndex >= 0) {
      const hole = HOLES[state.hungIndex];
      const vx = state.grabLocal.x - hole[0];
      const vy = state.grabLocal.y - hole[1];
      const target = Math.atan2(
        pointer.y - HOOK_ATTACH.y,
        pointer.x - HOOK_ATTACH.x
      );
      const localAng = Math.atan2(vy, vx);
      state.angle = target - localAng;
      pinToHook(state.hungIndex);
      return;
    }

    const grabRot = rotatePoint(
      state.grabLocal.x * SHAPE_SCALE,
      state.grabLocal.y * SHAPE_SCALE,
      state.angle
    );
    state.tx = pointer.x - grabRot.x;
    state.ty = pointer.y - grabRot.y;
  }

  function onPointerUp(event) {
    if (state.drawing) {
      if (scene.hasPointerCapture(event.pointerId)) {
        scene.releasePointerCapture(event.pointerId);
      }
      finishStroke();
      return;
    }

    if (!state.dragging) return;
    state.dragging = false;
    state.dragMode = null;
    app.classList.remove("is-dragging");

    if (state.hungIndex >= 0) return;

    const nearest = nearestHoleToHook();
    if (nearest.dist <= SNAP) {
      hangFrom(nearest.index);
    }
  }

  scene.addEventListener("pointerdown", onPointerDown);
  scene.addEventListener("pointermove", onPointerMove);
  scene.addEventListener("pointerup", onPointerUp);
  scene.addEventListener("pointercancel", onPointerUp);

  guessCmBtn.addEventListener("click", () => {
    setTool(state.tool === "guess-cm" ? "move" : "guess-cm");
  });

  pencilBtn.addEventListener("click", () => {
    if (state.tool === "pencil") {
      setTool("move");
      return;
    }
    setTool("pencil");
  });

  clearDrawingsBtn.addEventListener("click", clearDrawings);

  unhookBtn.addEventListener("click", resetToDefault);

  window.addEventListener("resize", layout);

  layout();
  requestAnimationFrame(step);
})();
