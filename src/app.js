(() => {
  const G = ChestGeometry,
    T = THREE,
    lib = chestLibrary(),
    $ = (id) => document.getElementById(id);
  const panel = $("panel"),
    footer = $("footer"),
    main = $("chest-room"),
    tools = $("tools");
  let records = [],
    profile = null,
    scan = null,
    values = {},
    entered = {},
    step = 0,
    unit = "cm",
    page = "",
    active = "front",
    tool = "orbit",
    busy = false,
    rev = null;
  let assets = {},
    chooser = null,
    fitName = "",
    measuring = false,
    libraryTab = "torso",
    opacity = 0.52,
    foam = 0;
  const labelOf = (id) => (id === "front" ? "Front plate" : "Back plate");
  function note(message = "") {
    $("status").textContent = message;
  }
  const studio = chestStudio($("scene"), $("cut"), syncNumbers, note);
  function el(tag, text = "", cls = "") {
    const e = document.createElement(tag);
    e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function add(tag, text, cls) {
    const e = el(tag, text, cls);
    panel.append(e);
    return e;
  }
  function btn(text, fn, primary = false) {
    const b = el("button", text, primary ? "primary" : "");
    b.type = "button";
    b.onclick = fn;
    return b;
  }
  function row(...children) {
    const r = el("div", "", "row");
    r.append(...children);
    panel.append(r);
    return r;
  }
  function title(text, kicker) {
    if (kicker) add("div", kicker, "eyebrow");
    add("h2", text);
  }
  function layout(which) {
    page = which;
    panel.replaceChildren();
    footer.replaceChildren();
    tools.replaceChildren();
    note();
    const fitting = which === "fit";
    main.classList.toggle("fit-mode", fitting);
    footer.hidden = !fitting;
    tools.hidden = true;
    $("home").hidden = which === "home";
    $("gesture").textContent =
      studio.mode === "3d"
        ? "Drag to orbit · Scroll to zoom"
        : "Scroll to zoom · Shift-drag to pan";
  }
  function setLock(on) {
    busy = on;
    main.querySelector("section").inert = on;
    $("home").disabled = on;
    main.classList.toggle("busy", on);
  }
  async function work(message, job) {
    if (busy) return;
    setLock(true);
    note(message);
    try {
      await job();
    } catch (e) {
      note(e.message || String(e));
    } finally {
      setLock(false);
    }
  }
  function freshId() {
    return lib.uid();
  }
  function torsoGeometry(v, key, frame = false) {
    const model = G.mannequin(v);
    studio.setBody(model.geometry, model.guides, key, frame);
  }
  function clearParts() {
    for (const id of ["front", "back"]) studio.remove(id);
    studio.setFoam(0);
    assets = {};
    active = "front";
    rev = null;
    fitName = "";
    measuring = false;
    tool = "orbit";
    studio.setTool(tool);
    opacity = 0.52;
    foam = 0;
  }
  function pickFile(fn) {
    chooser = fn;
    $("file").value = "";
    $("file").click();
  }
  $("file").onchange = () => {
    const f = $("file").files[0];
    if (f && chooser)
      work("Reading " + f.name + "…", async () => {
        if (f.size > 96 * 1024 * 1024)
          throw Error("Choose an STL under 96 MiB.");
        const bytes = await f.arrayBuffer(),
          geometry = G.readSTL(bytes);
        await chooser({ bytes, name: f.name }, geometry);
      });
  };
  function displayBody(p, scanGeo) {
    if (scanGeo) {
      const center = scanGeo.boundingBox.getCenter(new T.Vector3()),
        low = scanGeo.boundingBox.min.z;
      scanGeo.translate(-center.x, -center.y, -low);
      studio.setBody(scanGeo, null, null, true);
    } else torsoGeometry(p.values, null, true);
  }
  function home() {
    clearParts();
    profile = null;
    scan = null;
    torsoGeometry(G.defaults, null, true);
    studio.setMode(studio.has3d ? "3d" : "front");
    layout("home");
    title("Torso workshop");
    const tabs = row();
    for (const [id, text] of [
      ["torso", "Torsos"],
      ["fit", "Saved fits"],
    ]) {
      const b = btn(text, () => {
        libraryTab = id;
        home();
      });
      b.setAttribute("aria-pressed", id === libraryTab);
      tabs.append(b);
    }
    if (libraryTab === "torso") {
      add(
        "p",
        "Measure over your base layer, or bring a torso scan to try on your armor.",
      );
      row(
        btn("Make my torso", () => beginWizard(), true),
        btn("Use torso STL", () =>
          pickFile((a, g) => {
            clearParts();
            scan = a;
            profile = {
              kind: "torso",
              name: a.name.replace(/\.stl$/i, ""),
              source: "scan",
            };
            displayBody(profile, g);
            review();
          }),
        ),
      );
    }
    const list = records
      .filter((r) => r.kind === libraryTab)
      .sort((a, b) => b.created - a.created);
    if (list.length) {
      add("h3", libraryTab === "torso" ? "Your torsos" : "Your armor fits");
      const stack = add("div", "", "stack");
      for (const item of list) {
        const card = btn(
          item.name + (item.version ? " · " + item.version : ""),
          () =>
            work("Opening…", async () => {
              if (item.kind === "torso") {
                await openTorso(item);
                fitPanel();
              } else await openFit(item);
            }),
        );
        card.className = "item";
        card.append(
          el(
            "small",
            item.kind === "torso"
              ? item.source === "scan"
                ? "Torso scan"
                : Math.round(item.values.chest) + " mm chest"
              : (records.find((r) => r.id === item.torso)?.name || "Torso") +
                  " · " +
                  Object.keys(item.parts).map(labelOf).join(" + "),
          ),
        );
        stack.append(card);
      }
    } else if (libraryTab === "fit") {
      add(
        "p",
        "Save a fit from the armor view to return to the same torso, pieces and placement.",
      );
    }
  }
  function beginWizard(base = null) {
    clearParts();
    scan = null;
    profile = {
      kind: "torso",
      source: "measured",
      name: base ? base.name.slice(0, 66) + " · revised" : "My torso",
    };
    entered = base ? { ...base.values } : {};
    values = { ...G.defaults, ...entered };
    step = 0;
    torsoGeometry(values, null, true);
    studio.setMode(studio.has3d ? "3d" : "front");
    wizard();
  }
  function wizard() {
    layout("wizard");
    const s = G.steps[step];
    title(s.name, "Measurement " + (step + 1) + " of " + G.steps.length);
    add("p", s.help);
    const label = add("label", "Your measurement");
    label.htmlFor = "distance";
    const bar = add("div", "", "fieldrow"),
      input = el("input"),
      units = el("select");
    input.id = "distance";
    input.type = "number";
    input.step = "any";
    input.inputMode = "decimal";
    units.setAttribute("aria-label", "Units");
    const factor = () => ({ mm: 1, cm: 10, in: 25.4 })[unit];
    for (const u of ["cm", "mm", "in"]) units.add(new Option(u, u));
    units.value = unit;
    const show = () => {
      input.value =
        entered[s.key] == null
          ? ""
          : String(+(entered[s.key] / factor()).toFixed(3));
    };
    show();
    bar.append(input, units);
    const next = btn(
      step === 4 ? "Review torso" : "Next",
      () => {
        if (next.disabled) return;
        if (step === 4) {
          profile.values = { ...entered };
          review();
        } else {
          step++;
          wizard();
        }
      },
      true,
    );
    row(
      btn("Back", () => {
        if (step) {
          step--;
          wizard();
        } else home();
      }),
      next,
    );
    function update() {
      const n = input.valueAsNumber * factor();
      next.disabled = true;
      if (!Number.isFinite(n) || n < s.min || n > s.max) {
        note(
          input.value
            ? "Enter " +
                (s.min / factor()).toFixed(1) +
                "–" +
                (s.max / factor()).toFixed(1) +
                " " +
                unit +
                "."
            : "",
        );
        return;
      }
      const draft = { ...values, [s.key]: n };
      if (
        s.key === "chest" &&
        (entered.depth == null || 2 * entered.depth >= n)
      ) {
        delete entered.depth;
        draft.depth = (n * G.defaults.depth) / G.defaults.chest;
      }
      try {
        torsoGeometry(draft, s.key);
        values = draft;
        entered[s.key] = n;
        next.disabled = false;
        note();
      } catch (e) {
        note(e.message);
      }
    }
    units.onchange = () => {
      unit = units.value;
      show();
      update();
    };
    input.oninput = update;
    input.onkeydown = (e) => {
      if (e.key === "Enter" && !next.disabled) next.click();
    };
    next.disabled = entered[s.key] == null;
    torsoGeometry(values, s.key);
    studio.guideView(s.key);
    input.focus();
  }
  function review() {
    layout("review");
    title("Save your torso");
    if (profile.source === "measured") {
      torsoGeometry(profile.values, null);
      const list = add("dl", "", "measurelist");
      for (const s of G.steps) {
        const r = el("div");
        r.append(
          el("dt", s.name),
          el("dd", Math.round(profile.values[s.key] * 10) / 10 + " mm"),
        );
        list.append(r);
      }
    } else
      add(
        "p",
        "Use a scan in millimetres with the torso upright and the chest facing forward (−Y).",
      );
    const l = add("label", "Torso name"),
      name = el("input");
    name.maxLength = 80;
    name.value = profile.name;
    l.append(name);
    row(
      btn("Back", () => {
        if (profile.source === "measured") {
          step = 4;
          wizard();
        } else home();
      }),
      btn(
        "Save and fit armor",
        () =>
          work("Saving torso…", async () => {
            if (!name.value.trim()) throw Error("Give this torso a name.");
            const item = {
              ...profile,
              id: freshId(),
              created: Date.now(),
              name: name.value.trim(),
            };
            if (scan) item.mesh = await lib.store(scan);
            await lib.save(item);
            records.push(item);
            profile = item;
            studio.frameBody();
            studio.setMode(studio.has3d ? "3d" : "front");
            fitPanel();
          }),
        true,
      ),
    );
  }
  async function openTorso(p) {
    if (!p) throw Error("The saved torso is missing.");
    let a = null,
      g = null;
    if (p.source === "scan") {
      a = { id: p.mesh, name: p.name, bytes: await lib.read(p.mesh) };
      g = G.readSTL(a.bytes);
    }
    clearParts();
    profile = p;
    scan = a;
    displayBody(p, g);
    studio.setMode(studio.has3d ? "3d" : "front");
  }
  async function openFit(record) {
    await openTorso(records.find((r) => r.id === record.torso));
    for (const [id, s] of Object.entries(record.parts)) {
      const bytes = await lib.read(s.mesh);
      assets[id] = { id: s.mesh, name: s.file, bytes };
      studio.add(id, G.readSTL(bytes), s.pose);
    }
    active = record.active in assets ? record.active : Object.keys(assets)[0];
    studio.select(active);
    fitName = record.name;
    rev = record;
    foam = record.foam || 0;
    studio.setFoam(foam);
    fitPanel();
  }
  function loadPlate(id) {
    pickFile((a, g) => {
      assets[id] = a;
      active = id;
      studio.add(id, g);
      tool = "translate";
      studio.setTool(tool);
      opacityAll();
      fitPanel();
    });
  }
  function opacityAll() {
    for (const m of studio.layers.values()) {
      m.material.opacity = opacity;
      m.material.transparent = opacity < 1;
      m.material.depthWrite = opacity === 1;
      m.material.needsUpdate = true;
    }
    studio.draw();
  }
  function control(parent, text, value, apply, extra = {}) {
    const l = el("label", text),
      i = el("input");
    i.type = "number";
    i.step = "any";
    i.value = value;
    Object.assign(i, extra);
    i.required = true;
    i.oninput = () => {
      if (i.validity.valid) {
        apply(i.valueAsNumber);
        studio.measuring(false);
        measuring = false;
        studio.draw();
        note();
      } else note("Enter a value between " + i.min + " and " + i.max + ".");
      for (const b of footer.querySelectorAll("button"))
        b.disabled = !!panel.querySelector("input:invalid");
    };
    l.append(i);
    parent.append(l);
    return i;
  }
  function syncNumbers() {
    const m = studio.layers.get(active);
    if (!m) return;
    for (const [i, k] of ["x", "y", "z"].entries()) {
      if ($("pos" + i)) $("pos" + i).value = +m.position[k].toFixed(1);
      if ($("rot" + i))
        $("rot" + i).value = +((m.rotation[k] * 180) / Math.PI).toFixed(1);
    }
  }
  function currentRevision() {
    if (
      !rev ||
      foam !== (rev.foam || 0) ||
      Object.keys(assets).length !== Object.keys(rev.parts).length
    )
      return false;
    return Object.entries(assets).every(([id, a]) => {
      const stored = rev.parts[id];
      return (
        stored &&
        a.id === stored.mesh &&
        JSON.stringify(studio.pose(id)) === JSON.stringify(stored.pose)
      );
    });
  }
  function foamControl() {
    const enabled = el("input");
    enabled.type = "checkbox";
    enabled.checked = foam > 0;
    const label = add("label", "", "foam-toggle");
    label.append(enabled, "Preview foam pads");
    const change = (n) => {
      foam = n;
      if (!studio.setFoam(n))
        note(
          "The scan has an opening in the pad area. Try a complete torso scan.",
        );
    };
    enabled.onchange = () => {
      foam = enabled.checked ? 6 : 0;
      fitPanel();
      change(foam);
    };
    if (foam) {
      const l = add("label", "Pad thickness · "),
        value = el("output", foam + " mm");
      l.htmlFor = "foam";
      l.append(value);
      const input = el("input");
      input.type = "range";
      input.id = "foam";
      input.min = 1;
      input.max = 30;
      input.value = foam;
      input.oninput = () => {
        value.textContent = input.value + " mm";
        change(input.valueAsNumber);
      };
      panel.append(input);
      add(
        "p",
        "Gold pads follow the chest and upper back. Measure to their outer edges in a cut.",
        "muted",
      );
    }
  }
  function sliceControls() {
    const axis = studio.normal(),
      range = studio.getBounds();
    for (const m of studio.layers.values())
      range.union(new T.Box3().setFromObject(m));
    const l = add(
      "label",
      studio.mode === "top" ? "Slice height" : "Slice position",
    );
    l.htmlFor = "slice";
    const slider = el("input");
    slider.type = "range";
    slider.id = "slice";
    slider.min = Math.floor(range.min.getComponent(axis));
    slider.max = Math.ceil(range.max.getComponent(axis));
    slider.step = 1;
    slider.value = studio.slice;
    const out = el("output", Math.round(studio.slice) + " mm");
    l.append(" · ", out);
    slider.oninput = () => {
      studio.setSlice(slider.valueAsNumber);
      out.textContent = slider.value + " mm";
      if (measuring) note("Click the torso outline, then the plate.");
    };
    panel.append(slider);
    const b = btn("Measure gap", () => {
      measuring = !measuring;
      studio.measuring(measuring);
      b.setAttribute("aria-pressed", measuring);
      note(
        measuring
          ? "Click the torso or foam outline, then the selected plate’s inner edge."
          : "",
      );
    });
    b.setAttribute("aria-pressed", measuring);
    row(b);
    add(
      "p",
      "Mint · torso     Copper · front plate     Lavender · back plate",
      "muted",
    );
  }
  function fitPanel() {
    layout("fit");
    const ids = Object.keys(assets),
      m = studio.layers.get(active);
    title(ids.length ? "Fit armor" : "Try on armor", profile.name);
    if (!ids.length) {
      add(
        "p",
        "Start with a breastplate, a backplate, or an assembled cuirass STL. You can add the other piece afterward.",
      );
      row(
        btn("Add front plate", () => loadPlate("front"), true),
        btn("Add back plate", () => loadPlate("back")),
      );
      if (profile.source === "measured")
        row(btn("Modify torso", () => beginWizard(profile)));
      footer.hidden = true;
      return;
    }
    const pick = row();
    for (const id of ["front", "back"]) {
      const b = btn(
        assets[id] ? labelOf(id) : "Add " + labelOf(id).toLowerCase(),
        () => {
          if (!assets[id]) return loadPlate(id);
          active = id;
          studio.select(id);
          measuring = false;
          studio.measuring(false);
          fitPanel();
        },
      );
      b.setAttribute("aria-pressed", active === id);
      pick.append(b);
    }
    add(
      "p",
      assets[active].name + (rev ? " · " + rev.name + " " + rev.version : ""),
      "muted",
    );
    const views = row();
    views.classList.add("compact");
    for (const [id, text] of [
      ["3d", "3D"],
      ["front", "Front cut"],
      ["side", "Side cut"],
      ["top", "Top cut"],
    ]) {
      if (id === "3d" && !studio.has3d) continue;
      const b = btn(text, () => {
        measuring = false;
        studio.setMode(id);
        fitPanel();
      });
      b.setAttribute("aria-pressed", studio.mode === id);
      views.append(b);
    }
    if (studio.mode === "3d") {
      tools.hidden = false;
      for (const [id, text] of [
        ["orbit", "Orbit"],
        ["translate", "Move"],
        ["rotate", "Rotate"],
      ]) {
        const b = btn(text, () => {
          tool = id;
          studio.setTool(id);
          fitPanel();
        });
        b.setAttribute("aria-pressed", tool === id);
        tools.append(b);
      }
      const l = add("label", "Armor opacity"),
        slider = el("input");
      slider.type = "range";
      slider.min = 0;
      slider.max = 100;
      slider.value = Math.round(opacity * 100);
      slider.setAttribute("aria-label", "Armor opacity");
      l.append(slider);
      slider.oninput = () => {
        opacity = slider.valueAsNumber / 100;
        opacityAll();
      };
    } else {
      sliceControls();
      $("gesture").textContent = "Drag plate · Shift-drag to pan";
    }
    control(
      panel,
      "Plate scale (%)",
      +(m.scale.x * 100).toFixed(2),
      (n) => m.scale.setScalar(n / 100),
      { min: 1, max: 2000, id: "scale" },
    );
    foamControl();
    const details = add("details", "");
    details.append(el("summary", "Precise alignment"));
    const nums = el("div", "", "numeric"),
      rot = el("div", "", "numeric");
    details.append(nums, rot);
    for (const [i, k] of ["x", "y", "z"].entries()) {
      control(
        nums,
        k.toUpperCase() + " (mm)",
        +m.position[k].toFixed(1),
        (n) => (m.position[k] = n),
        { id: "pos" + i, min: -10000, max: 10000 },
      );
      control(
        rot,
        k.toUpperCase() + " (°)",
        +((m.rotation[k] * 180) / Math.PI).toFixed(1),
        (n) => (m.rotation[k] = (n * Math.PI) / 180),
        { id: "rot" + i, min: -360, max: 360 },
      );
    }
    details.append(
      btn("Reset this plate", () => {
        const a = assets[active];
        studio.add(active, G.readSTL(a.bytes));
        opacityAll();
        fitPanel();
      }),
    );
    row(
      btn("Replace " + labelOf(active).toLowerCase(), () => loadPlate(active)),
    );
    details.append(btn("Save shoulder reference for Arm Room",()=>work("Preparing shoulder reference…",async()=>{
      if(profile.source!=="measured")throw Error("Use a measured torso for shoulder landmarks, or open the fitted plate STL directly in Arm Room.");
      const {shoulders,depth,length}=profile.values;
      // Match the torso generator’s outer shoulder ring, including its posterior offset.
      const anchors=[1,-1].map(sign=>[sign*shoulders/2,depth*.055,length*(.22+.93)]);
      const data=G.shoulderReference([...studio.layers.values()],anchors);
      const name=(rev?rev.name+"-"+rev.version:profile.name)+"-shoulder-reference";
      const result=await lib.send(data,name,"reference");
      note(result.download?"Shoulder reference downloaded. Choose it in Arm Room.":"Choose this reference in Arm Room: "+result.path);
    })));
    footer.append(
      btn("Save fit…", saveDialog),
      btn(
        lib.native ? "Open plate in OrcaSlicer" : "Download fitted plate",
        () =>
          work("Preparing fitted STL…", async () => {
            const bytes = G.stl(m),
              base =
                (rev
                  ? rev.name +
                    "-" +
                    rev.version +
                    (currentRevision() ? "" : "-modified")
                  : assets[active].name.replace(/\.stl$/i, "")) +
                "-" +
                active +
                "-fitted";
            const result = await lib.send(bytes, base);
            note(
              result.download
                ? "Fitted plate downloaded."
                : result.opened
                  ? "Fitted plate sent to OrcaSlicer."
                  : "Fitted STL saved. Open " + result.path + " in OrcaSlicer.",
            );
          }),
        true,
      ),
    );
  }
  function saveDialog() {
    const d = el("dialog"),
      head = el("h2", "Save armor fit"),
      l = el("label", "Fit name"),
      n = el("input"),
      vl = el("label", "Version"),
      v = el("input"),
      error = el("p", "", "muted");
    n.value = fitName || assets[active].name.replace(/\.stl$/i, "");
    n.maxLength = 80;
    v.maxLength = 30;
    l.append(n);
    vl.append(v);
    const existing = (name, version) =>
      records.some(
        (r) =>
          r.kind === "fit" &&
          r.torso === profile.id &&
          r.name === name &&
          r.version === version,
      );
    function next() {
      let i = 1;
      while (existing(n.value.trim(), "v" + i)) i++;
      v.value = "v" + i;
    }
    next();
    n.oninput = next;
    const cancel = btn("Cancel", () => d.close()),
      save = btn(
        "Save version",
        async () => {
          const name = n.value.trim(),
            version = v.value.trim();
          if (!name || !version || existing(name, version)) {
            error.textContent = "Enter a name and an unused version.";
            return;
          }
          save.disabled = cancel.disabled = true;
          d.oncancel = (e) => e.preventDefault();
          error.textContent = "Saving…";
          try {
            const parts = {};
            for (const [id, a] of Object.entries(assets))
              parts[id] = {
                mesh: await lib.store(a),
                file: a.name,
                pose: studio.pose(id),
              };
            const item = {
              kind: "fit",
              id: freshId(),
              torso: profile.id,
              name,
              version,
              parts,
              active,
              foam,
              created: Date.now(),
            };
            await lib.save(item);
            records.push(item);
            rev = item;
            fitName = name;
            d.close();
            fitPanel();
            note("Saved " + name + " · " + version + ".");
          } catch (e) {
            error.textContent = e.message;
          } finally {
            save.disabled = cancel.disabled = false;
            d.oncancel = null;
          }
        },
        true,
      );
    const actions = el("div", "", "row");
    actions.append(cancel, save);
    d.append(head, l, vl, error, actions);
    main.append(d);
    d.onclose = () => d.remove();
    d.showModal();
    n.select();
  }
  $("reset").onclick = () => studio.frameBody();
  $("home").onclick = () => {
    if (!busy) home();
  };
  home();
  work("Opening library…", async () => {
    records = await lib.list();
    home();
  });
})();
