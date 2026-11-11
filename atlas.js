(function (root) {
  "use strict";

  const regions = {
    himalaya: {
      wide: [64, 18, 104, 44], close: [82, 25.5, 90, 31.5], center: [84, 30],
      title: "喜马拉雅山脉", titleEn: "THE HIMALAYAN ARC",
      locale: "中尼边境", localeEn: "LHENDE–BHOTE KOSHI CORRIDOR"
    },
    andes: {
      wide: [-79, -50, -65, -34], close: [-74, -44.7, -70.8, -42], center: [-72, -42],
      title: "巴塔哥尼亚安第斯", titleEn: "PATAGONIAN ANDES",
      locale: "智利 · Río Burritos", localeEn: "VILLA SANTA LUCÍA"
    }
  };
  const clamp = value => Math.max(0, Math.min(1, value));
  const ease = value => {
    const t = clamp(value);
    return t * t * (3 - 2 * t);
  };
  const mix = (a, b, t) => a + (b - a) * t;

  function create(stage) {
    const canvas = stage.querySelector("canvas");
    const context = canvas.getContext("2d");
    const title = stage.querySelector("[data-atlas-title]");
    const english = stage.querySelector("[data-atlas-en]");
    const pin = stage.querySelector("[data-atlas-pin]");
    const loaded = {};
    let world;
    let region;
    let key;
    let lastOpening;

    for (const id of Object.keys(regions)) {
      loaded[id] = {};
      for (const [name, filename] of [["wide", "wide"], ["close", "corridor"]]) {
        const image = new Image();
        image.onload = () => { if (world && id === key && lastOpening !== undefined) render(lastOpening); };
        image.src = "assets/" + id + "-" + filename + ".jpg";
        loaded[id][name] = image;
      }
    }

    function set(next) {
      world = next;
      key = world.sceneId === "andes" ? "andes" : "himalaya";
      region = regions[key];
    }

    function render(opening) {
      lastOpening = opening;
      stage.hidden = opening === undefined;
      if (opening === undefined) return;
      const width = stage.clientWidth;
      const height = stage.clientHeight;
      if (!width || !height) return;
      const dpr = Math.min(2, devicePixelRatio || 1);
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const [west, south, east, north] = world.grid.bounds;
      const localCenter = [(west + east) / 2, (south + north) / 2];
      const [wideW, wideS, wideE, wideN] = region.wide;
      const initialSpan = 0.94 * Math.min(wideE - wideW, (wideN - wideS) * width / height);
      const finalSpan = Math.max(east - west, (north - south) * width / height) * 1.22;
      const direction = ease(opening / 0.82);
      const span = initialSpan * Math.pow(finalSpan / initialSpan, direction);
      const center = region.center.map((value, index) => mix(value, localCenter[index], ease(opening / 0.68)));
      const scale = width / span;
      const x = longitude => (longitude - center[0]) * scale + width / 2;
      const y = latitude => (center[1] - latitude) * scale + height / 2;

      context.clearRect(0, 0, width, height);
      context.fillStyle = "#18221e";
      context.fillRect(0, 0, width, height);
      for (const name of ["wide", "close"]) {
        const image = loaded[key][name];
        if (!image.naturalWidth) continue;
        const [w, s, e, n] = region[name];
        context.globalAlpha = name === "close" ? ease((opening - 0.34) / 0.21) : 1;
        context.drawImage(image, x(w), y(n), (e - w) * scale, (n - s) * scale);
      }
      context.globalAlpha = 1;
      const source = world.waves[0]?.path[0];
      if (source) {
        const px = x(west + (east - west) * source.x / world.grid.cols);
        const py = y(north - (north - south) * source.y / world.grid.rows);
        pin.style.transform = "translate(" + px + "px," + py + "px)";
        pin.style.opacity = ease((opening - 0.2) / 0.22);
        pin.hidden = px < 28 || px > width - 28 || py < 30 || py > height - 30;
      }
      const local = opening >= 0.46;
      const nextTitle = local ? region.locale : region.title;
      if (title.textContent !== nextTitle) {
        title.textContent = nextTitle;
        english.textContent = local ? region.localeEn : region.titleEn;
      }
      stage.style.opacity = 1 - ease((opening - 0.83) / 0.17);
    }
    return { set, render };
  }

  root.RunoutAtlas = { create };
})(globalThis);
