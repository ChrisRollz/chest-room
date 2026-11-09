function chestStudio(canvas, sectionCanvas, changed, readout) {
  const T = THREE,
    G = ChestGeometry,
    scene = new T.Scene(),
    camera = new T.OrthographicCamera(-300, 300, 350, -350, 1, 20000);
  camera.up.set(0, 0, 1);
  let renderer,
    orbit,
    gizmo,
    body,
    guide,
    grid,
    active,
    tool = "orbit",
    mode = "3d",
    span = 660,
    target = new T.Vector3(0, 0, 245);
  let slice = 0,
    pan = [0, 0],
    zoom = 1,
    pointer = null,
    measurement = [],
    measureMode = false,
    cache = [],
    screen,
    frame = 0;
  const layers = new Map(),
    colors = {
      body: "#89d4bc",
      front: "#eda76d",
      back: "#a8adef",
      foam: "#f4d68b",
    };
  let pads = [],
    surfaces = null;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    orbit = new T.OrbitControls(camera, canvas);
    orbit.mouseButtons.MIDDLE = T.MOUSE.PAN;
    orbit.minZoom = 0.1;
    orbit.maxZoom = 16;
    orbit.addEventListener("change", draw);
    gizmo = new T.TransformControls(camera, canvas);
    gizmo.setSize(0.8);
    gizmo.setSpace("world");
    scene.add(gizmo);
    gizmo.addEventListener(
      "dragging-changed",
      (e) => (orbit.enabled = !e.value),
    );
    gizmo.addEventListener("change", draw);
    gizmo.addEventListener("objectChange", () => {
      changed();
      draw();
    });
    scene.add(new T.HemisphereLight(0xe6fff6, 0x596b7c, 1.0));
    for (const [x, y, z, power] of [
      [-3, -4, 6, 0.9],
      [3, 2, 3, 0.6],
    ]) {
      const light = new T.DirectionalLight(0xffffff, power);
      light.position.set(x, y, z);
      scene.add(light);
    }
  } catch (e) {
    renderer = null;
    mode = "front";
  }
  function material(color, alpha = 1) {
    const m = new T.MeshStandardMaterial({
      color,
      side: T.DoubleSide,
      roughness: 0.83,
      transparent: alpha < 1,
      opacity: alpha,
      depthWrite: alpha === 1,
    });
    m.color.convertSRGBToLinear();
    return m;
  }
  function dispose(m) {
    if (!m) return;
    scene.remove(m);
    m.material?.dispose();
    m.geometry?.dispose();
  }
  function frameBody() {
    const box = new T.Box3().setFromObject(body),
      size = box.getSize(new T.Vector3());
    target = box.getCenter(new T.Vector3());
    span = Math.max(size.x * 1.4, size.z * 1.26, size.y * 1.45);
    if (renderer) {
      orbit.target.copy(target);
      camera.position
        .copy(target)
        .add(
          new T.Vector3(0.43, -1, 0.23).normalize().multiplyScalar(span * 2.6),
        );
      camera.zoom = 1;
      orbit.update();
    }
    zoom = 1;
    pan = [0, 0];
    draw();
  }
  function setBody(geometry, paths, key, fitCamera = false) {
    for (const pad of pads) dispose(pad);
    pads = [];
    surfaces = null;
    dispose(body);
    dispose(guide);
    guide = null;
    body = new T.Mesh(geometry, material(colors.body));
    scene.add(body);
    if (key && paths?.[key]) {
      const points = paths[key].map((p) => new T.Vector3(...p));
      guide = new T.Line(
        new T.BufferGeometry().setFromPoints(points),
        new T.LineBasicMaterial({ color: 0xffcd88, depthTest: false }),
      );
      guide.renderOrder = 9;
      scene.add(guide);
    }
    if (!grid) {
      grid = new T.GridHelper(1000, 20, 0x415854, 0x304143);
      grid.rotation.x = Math.PI / 2;
      scene.add(grid);
    }
    if (fitCamera) frameBody();
    draw();
    return body;
  }
  function guideView(key) {
    if (!renderer) {
      setMode(key === "depth" ? "side" : "front");
      return;
    }
    const direction =
      key === "depth"
        ? new T.Vector3(1, -0.17, 0.12)
        : new T.Vector3(0.15, -1, 0.1);
    camera.position
      .copy(orbit.target)
      .addScaledVector(direction.normalize(), span * 2.6);
    orbit.update();
    draw();
  }
  function setFoam(mm) {
    for (const pad of pads) dispose(pad);
    pads = [];
    measurement = [];
    if (mm > 0) {
      surfaces ??= G.padSurfaces(body);
      for (const surface of surfaces) {
        const mesh = new T.Mesh(
          G.foamGeometry(surface, mm),
          material(colors.foam),
        );
        scene.add(mesh);
        pads.push(mesh);
      }
    }
    draw();
    return mm === 0 || pads.length > 0;
  }
  function getBounds() {
    return new T.Box3().setFromObject(body);
  }
  function axes() {
    return mode === "side"
      ? [1, 2, -1]
      : mode === "top"
        ? [0, 1, 1]
        : [0, 2, 1];
  }
  function normal() {
    return mode === "side" ? 0 : mode === "top" ? 2 : 1;
  }
  function setMode(next) {
    mode = next === "3d" && !renderer ? "front" : next;
    measurement = [];
    measureMode = false;
    pan = [0, 0];
    zoom = 1;
    slice = getBounds().getCenter(new T.Vector3()).getComponent(normal());
    setTool(tool);
    draw();
  }
  function setTool(next) {
    tool = next;
    if (gizmo) {
      if (mode === "3d" && active && tool !== "orbit") {
        gizmo.setMode(tool);
        gizmo.attach(active);
      } else gizmo.detach();
    }
    draw();
  }
  function select(id) {
    active = layers.get(id) || null;
    setTool(tool);
    measurement = [];
    draw();
  }
  function remove(id) {
    if (active === layers.get(id)) {
      gizmo?.detach();
      active = null;
    }
    dispose(layers.get(id));
    layers.delete(id);
    draw();
  }
  function add(id, g, pose) {
    remove(id);
    g.computeBoundingBox();
    const ctr = g.boundingBox.getCenter(new T.Vector3()),
      size = g.boundingBox.getSize(new T.Vector3());
    g.translate(-ctr.x, -ctr.y, -ctr.z);
    const mesh = new T.Mesh(g, material(colors[id], 0.52));
    const bounds = getBounds(),
      center = bounds.getCenter(new T.Vector3());
    mesh.position.copy(center);
    const torsoDepth = bounds.max.y - bounds.min.y;
    if (size.y < torsoDepth * 0.8) {
      const clearance = size.y < torsoDepth * 0.15 ? size.y + 4 : 6;
      mesh.position.y =
        id === "front"
          ? bounds.min.y - clearance + size.y / 2
          : bounds.max.y + clearance - size.y / 2;
    }
    if (pose) {
      mesh.position.fromArray(pose.position);
      mesh.quaternion.fromArray(pose.quaternion);
      mesh.scale.fromArray(pose.scale);
    }
    scene.add(mesh);
    layers.set(id, mesh);
    select(id);
    return mesh;
  }
  function cutDraw() {
    const w = sectionCanvas.clientWidth,
      h = sectionCanvas.clientHeight;
    if (!w || !h || !body) return;
    const dpi = Math.min(devicePixelRatio, 2);
    sectionCanvas.width = w * dpi;
    sectionCanvas.height = h * dpi;
    const ctx = sectionCanvas.getContext("2d");
    ctx.setTransform(dpi, 0, 0, dpi, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const [a, b, sign] = axes(),
      factor = (Math.min(w, h) * zoom) / span;
    const project = (p) => [
      w / 2 +
        pan[0] +
        (p.getComponent(a) - target.getComponent(a)) * factor * sign,
      h / 2 + pan[1] - (p.getComponent(b) - target.getComponent(b)) * factor,
    ];
    screen = { project, factor, a, b, sign };
    cache = [];
    for (const [id, mesh] of [
      ["body", body],
      ...pads.map((m) => ["foam", m]),
      ...layers,
    ]) {
      if (!mesh.visible) continue;
      const lines = G.cut(mesh, normal(), slice);
      cache.push({ id, mesh, lines });
      ctx.beginPath();
      for (const [one, two] of lines) {
        ctx.moveTo(...project(one));
        ctx.lineTo(...project(two));
      }
      ctx.strokeStyle = colors[id];
      ctx.lineWidth = id === "body" ? 2.2 : 1.8;
      ctx.stroke();
    }
    if (guide && layers.size === 0) {
      const pos = guide.geometry.attributes.position;
      ctx.beginPath();
      for (let i = 0; i < pos.count; i++) {
        const p = project(new T.Vector3().fromBufferAttribute(pos, i));
        if (i) ctx.lineTo(...p);
        else ctx.moveTo(...p);
      }
      ctx.strokeStyle = "#ffd092";
      ctx.stroke();
    }
    if (measurement.length) {
      ctx.beginPath();
      measurement.forEach((p, i) =>
        i ? ctx.lineTo(...project(p)) : ctx.moveTo(...project(p)),
      );
      ctx.strokeStyle = "#ffdb9a";
      ctx.stroke();
      for (const p of measurement) {
        ctx.beginPath();
        ctx.arc(...project(p), 4, 0, Math.PI * 2);
        ctx.fillStyle = "#ffdb9a";
        ctx.fill();
      }
    }
  }
  function draw() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      canvas.hidden = mode !== "3d";
      sectionCanvas.hidden = mode === "3d";
      if (mode !== "3d") {
        cutDraw();
        return;
      }
      const w = canvas.clientWidth,
        h = canvas.clientHeight;
      if (!w || !h || !renderer) return;
      const ratio = w / h;
      camera.top = span * 0.5 * Math.max(1, 1 / ratio);
      camera.bottom = -camera.top;
      camera.right = camera.top * ratio;
      camera.left = -camera.right;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
      renderer.render(scene, camera);
    });
  }
  function pick(x, y) {
    if (!screen || !active) return;
    if (measurement.length === 2) measurement = [];
    let nearest = 18,
      point = null;
    for (const entry of cache.filter((e) =>
      measurement.length
        ? e.mesh === active
        : e.id === "body" || e.id === "foam",
    ))
      for (const [p, q] of entry.lines) {
        const [ax, ay] = screen.project(p),
          [bx, by] = screen.project(q),
          dx = bx - ax,
          dy = by - ay;
        const t = Math.max(
          0,
          Math.min(
            1,
            ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1),
          ),
        );
        const gap = Math.hypot(x - ax - t * dx, y - ay - t * dy);
        if (gap < nearest) {
          nearest = gap;
          point = p.clone().lerp(q, t);
        }
      }
    if (point) {
      measurement.push(point);
      readout(
        measurement.length === 2
          ? measurement[0].distanceTo(point).toFixed(1) +
              " mm between these points."
          : "Now click the inner edge of the selected plate.",
      );
      draw();
    } else
      readout(
        measurement.length
          ? "Click closer to the selected plate outline."
          : "Click closer to the torso outline.",
      );
  }
  sectionCanvas.onpointerdown = (e) => {
    if (!screen) return;
    const rect = sectionCanvas.getBoundingClientRect();
    if (measureMode && e.button === 0 && !e.shiftKey) {
      pick(e.clientX - rect.left, e.clientY - rect.top);
      return;
    }
    pointer = {
      x: e.clientX,
      y: e.clientY,
      pan: e.shiftKey || e.button !== 0 || !active,
    };
    sectionCanvas.setPointerCapture(e.pointerId);
  };
  sectionCanvas.onpointermove = (e) => {
    if (!pointer || !screen) return;
    const dx = e.clientX - pointer.x,
      dy = e.clientY - pointer.y;
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    if (pointer.pan) {
      pan[0] += dx;
      pan[1] += dy;
    } else {
      const { a, b, sign, factor } = screen;
      active.position.setComponent(
        a,
        active.position.getComponent(a) + (dx * sign) / factor,
      );
      active.position.setComponent(
        b,
        active.position.getComponent(b) - dy / factor,
      );
      measurement = [];
      changed();
    }
    draw();
  };
  sectionCanvas.onlostpointercapture = () => (pointer = null);
  sectionCanvas.oncontextmenu = (e) => e.preventDefault();
  sectionCanvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom = Math.max(
        0.15,
        Math.min(14, zoom * Math.exp(-Math.sign(e.deltaY) * 0.12)),
      );
      draw();
    },
    { passive: false },
  );
  new ResizeObserver(draw).observe(canvas.parentElement);
  return {
    layers,
    add,
    remove,
    select,
    setBody,
    getBounds,
    setMode,
    get mode() {
      return mode;
    },
    has3d: !!renderer,
    setTool,
    draw,
    frameBody,
    guideView,
    setFoam,
    setSlice(n) {
      slice = n;
      measurement = [];
      draw();
    },
    get slice() {
      return slice;
    },
    normal,
    measuring(on) {
      measureMode = on;
      measurement = [];
      draw();
    },
    pose(id) {
      const m = layers.get(id);
      return {
        position: m.position.toArray(),
        quaternion: m.quaternion.toArray(),
        scale: m.scale.toArray(),
      };
    },
  };
}
