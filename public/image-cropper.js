/**
 * ImagePreviewCropper — reusable image preview + crop component
 *
 * Usage:
 *   ImagePreviewCropper.open(file, {
 *     type: "banner" | "avatar" | "listing",
 *     onConfirm(croppedBlob, originalFile) { ... },
 *     onOriginal(originalFile) { ... },
 *     onCancel() { ... }
 *   });
 */
window.ImagePreviewCropper = (function () {
  "use strict";

  var PRESETS = {
    banner:  { label: "Banner",               recW: 1200, recH: 400,  ratio: 3/1 },
    avatar:  { label: "Profile Image / Avatar", recW: 400,  recH: 400,  ratio: 1/1 },
    listing: { label: "Listing Photo",         recW: 1080, recH: 1080, ratio: 1/1 }
  };

  var overlay = null;
  var canvas  = null;
  var ctx     = null;
  var img     = null;

  // Crop state
  var cropX, cropY, cropW, cropH;
  var dragging = false, dragStartX, dragStartY, dragOrigCropX, dragOrigCropY;
  var resizing = false, resizeEdge = null, resizeStartX, resizeStartY, resizeOrigCrop = {};

  // Display
  var dispX, dispY, dispW, dispH; // image drawn area within canvas
  var preset;
  var _onConfirm, _onOriginal, _onCancel;
  var scale; // ratio of original image to displayed image

  var MIN_CROP = 30; // minimum crop size in canvas px

  function open(file, opts) {
    if (!file) return;
    preset = PRESETS[opts.type] || PRESETS.listing;
    _onConfirm = opts.onConfirm || function(){};
    _onOriginal = opts.onOriginal || function(){};
    _onCancel = opts.onCancel || function(){};

    var reader = new FileReader();
    reader.onload = function (e) {
      img = new Image();
      img.onload = function () { buildUI(file); };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  function gcd(a, b) { return b ? gcd(b, a % b) : a; }
  function simplify(w, h) {
    var g = gcd(w, h);
    return (w/g) + ":" + (h/g);
  }

  function buildUI(file) {
    if (overlay) overlay.remove();

    overlay = document.createElement("div");
    overlay.id = "imgCropOverlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(2,6,23,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;";

    var panel = document.createElement("div");
    panel.style.cssText = "background:#0d1424;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:20px;color:#e2e8f0;max-width:700px;width:95%;max-height:95vh;overflow-y:auto;";

    // Header
    var header = document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;";
    header.innerHTML = '<div style="font-size:18px;font-weight:700;">Image Preview</div>';
    var closeBtn = document.createElement("button");
    closeBtn.textContent = "Cancel";
    closeBtn.style.cssText = "padding:6px 16px;background:transparent;border:1px solid #475569;border-radius:8px;color:#94a3b8;cursor:pointer;font-size:13px;";
    closeBtn.onclick = function () { cleanup(); _onCancel(); };
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Info bar
    var info = document.createElement("div");
    info.style.cssText = "margin-bottom:12px;font-size:13px;color:#94a3b8;line-height:1.7;";
    var imgRatio = simplify(img.naturalWidth, img.naturalHeight);
    var recRatio = simplify(preset.recW, preset.recH);
    var ratioMatch = Math.abs((img.naturalWidth / img.naturalHeight) - preset.ratio) < 0.08;
    var sizeWarning = file.size > 5 * 1024 * 1024;

    info.innerHTML =
      '<div><strong>Dimensions:</strong> ' + img.naturalWidth + ' x ' + img.naturalHeight + 'px (' + imgRatio + ')</div>' +
      '<div><strong>Recommended:</strong> ' + preset.recW + ' x ' + preset.recH + 'px (' + recRatio + ') for ' + preset.label + '</div>' +
      '<div><strong>File size:</strong> ' + formatSize(file.size) + (sizeWarning ? ' <span style="color:#eab308;font-weight:600;">&#9888; Large file — may be slow to upload</span>' : '') + '</div>';

    if (!ratioMatch) {
      info.innerHTML += '<div style="color:#eab308;margin-top:6px;padding:8px 12px;background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.2);border-radius:8px;">' +
        '&#9888; This image is ' + imgRatio + ' — recommended ratio is ' + recRatio + ' for ' + preset.label.toLowerCase() + '. It may be cropped.' +
        '</div>';
    }
    panel.appendChild(info);

    // Canvas container
    var canvasWrap = document.createElement("div");
    canvasWrap.style.cssText = "position:relative;background:#0a0e1a;border-radius:10px;overflow:hidden;margin-bottom:16px;touch-action:none;";

    canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100%;cursor:move;";
    canvasWrap.appendChild(canvas);
    panel.appendChild(canvasWrap);

    // Instruction
    var hint = document.createElement("div");
    hint.style.cssText = "font-size:12px;color:#64748b;margin-bottom:16px;text-align:center;";
    hint.textContent = "Drag the crop area to reposition. Drag edges to resize.";
    panel.appendChild(hint);

    // Buttons
    var btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";

    var confirmBtn = document.createElement("button");
    confirmBtn.textContent = "Confirm & Upload";
    confirmBtn.style.cssText = "flex:1;padding:12px 16px;background:#22c55e;color:#fff;border:none;border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;";
    confirmBtn.onclick = function () { doCrop(file); };

    var origBtn = document.createElement("button");
    origBtn.textContent = "Upload Original";
    origBtn.style.cssText = "flex:1;padding:12px 16px;background:transparent;border:1px solid #475569;color:#e2e8f0;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;";
    origBtn.onclick = function () { cleanup(); _onOriginal(file); };

    var cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText = "padding:12px 16px;background:transparent;border:1px solid #475569;color:#94a3b8;border-radius:8px;font-size:14px;cursor:pointer;";
    cancelBtn.onclick = function () { cleanup(); _onCancel(); };

    btnRow.appendChild(confirmBtn);
    btnRow.appendChild(origBtn);
    btnRow.appendChild(cancelBtn);
    panel.appendChild(btnRow);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) { cleanup(); _onCancel(); } });

    // Setup canvas
    setupCanvas(canvasWrap);

    // Events
    canvas.addEventListener("mousedown", onPointerDown);
    canvas.addEventListener("mousemove", onPointerMove);
    canvas.addEventListener("mouseup", onPointerUp);
    canvas.addEventListener("mouseleave", onPointerUp);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onPointerUp);
    canvas.addEventListener("touchcancel", onPointerUp);
  }

  function setupCanvas(canvasWrap) {
    // Size canvas to fit panel (max ~660px wide)
    var maxW = Math.min(660, canvasWrap.clientWidth || 660);
    var imgAspect = img.naturalWidth / img.naturalHeight;

    // Canvas height: fit image within maxW x 440
    var maxH = 440;
    var cw, ch;
    if (imgAspect > maxW / maxH) {
      cw = maxW;
      ch = Math.round(maxW / imgAspect);
    } else {
      ch = Math.min(maxH, Math.round(maxW / imgAspect));
      cw = Math.round(ch * imgAspect);
    }
    // ensure minimum
    if (ch < 120) { ch = 120; cw = Math.round(ch * imgAspect); }

    canvas.width = cw;
    canvas.height = ch;
    ctx = canvas.getContext("2d");

    // Image fits the full canvas
    dispX = 0; dispY = 0; dispW = cw; dispH = ch;
    scale = img.naturalWidth / dispW;

    // Init crop centered with correct aspect ratio
    initCrop();
    draw();
  }

  function initCrop() {
    var ratio = preset.ratio;
    // Fit crop inside displayed image
    var cw = dispW;
    var ch = dispH;
    var w, h;
    if (cw / ch > ratio) {
      h = ch;
      w = Math.round(h * ratio);
    } else {
      w = cw;
      h = Math.round(w / ratio);
    }
    cropW = w;
    cropH = h;
    cropX = dispX + Math.round((dispW - w) / 2);
    cropY = dispY + Math.round((dispH - h) / 2);
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw image
    ctx.drawImage(img, dispX, dispY, dispW, dispH);

    // Dim outside crop
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    // top
    ctx.fillRect(0, 0, canvas.width, cropY);
    // bottom
    ctx.fillRect(0, cropY + cropH, canvas.width, canvas.height - cropY - cropH);
    // left
    ctx.fillRect(0, cropY, cropX, cropH);
    // right
    ctx.fillRect(cropX + cropW, cropY, canvas.width - cropX - cropW, cropH);

    // Crop border
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2;
    ctx.strokeRect(cropX, cropY, cropW, cropH);

    // Rule of thirds
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    for (var i = 1; i <= 2; i++) {
      var xLine = cropX + Math.round(cropW * i / 3);
      var yLine = cropY + Math.round(cropH * i / 3);
      ctx.beginPath(); ctx.moveTo(xLine, cropY); ctx.lineTo(xLine, cropY + cropH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cropX, yLine); ctx.lineTo(cropX + cropW, yLine); ctx.stroke();
    }

    // Corner handles
    var hs = 10;
    ctx.fillStyle = "#22c55e";
    var corners = [
      [cropX - 1, cropY - 1],
      [cropX + cropW - hs + 1, cropY - 1],
      [cropX - 1, cropY + cropH - hs + 1],
      [cropX + cropW - hs + 1, cropY + cropH - hs + 1]
    ];
    corners.forEach(function(c) {
      ctx.fillRect(c[0], c[1], hs, hs);
    });

    // Dimension label inside crop
    var origCropW = Math.round(cropW * scale);
    var origCropH = Math.round(cropH * scale);
    var label = origCropW + " x " + origCropH + "px";
    ctx.font = "bold 12px sans-serif";
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    var tw = ctx.measureText(label).width;
    ctx.fillRect(cropX + cropW/2 - tw/2 - 6, cropY + cropH - 26, tw + 12, 20);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(label, cropX + cropW/2, cropY + cropH - 12);
    ctx.textAlign = "start";
  }

  function getCanvasPos(e) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function getEdge(pos) {
    var m = 14; // margin for edge detection
    var inX = pos.x >= cropX - m && pos.x <= cropX + cropW + m;
    var inY = pos.y >= cropY - m && pos.y <= cropY + cropH + m;
    if (!inX || !inY) return null;

    var nearL = Math.abs(pos.x - cropX) < m;
    var nearR = Math.abs(pos.x - (cropX + cropW)) < m;
    var nearT = Math.abs(pos.y - cropY) < m;
    var nearB = Math.abs(pos.y - (cropY + cropH)) < m;

    if (nearT && nearL) return "tl";
    if (nearT && nearR) return "tr";
    if (nearB && nearL) return "bl";
    if (nearB && nearR) return "br";
    if (nearT) return "t";
    if (nearB) return "b";
    if (nearL) return "l";
    if (nearR) return "r";
    // Inside crop area → drag
    if (pos.x > cropX && pos.x < cropX + cropW && pos.y > cropY && pos.y < cropY + cropH) return "move";
    return null;
  }

  function setCursor(edge) {
    var cursors = { tl: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize", br: "nwse-resize",
      t: "ns-resize", b: "ns-resize", l: "ew-resize", r: "ew-resize", move: "move" };
    canvas.style.cursor = cursors[edge] || "default";
  }

  function onPointerDown(e) {
    var pos = getCanvasPos(e);
    var edge = getEdge(pos);
    if (!edge) return;
    e.preventDefault();
    if (edge === "move") {
      dragging = true;
      dragStartX = pos.x; dragStartY = pos.y;
      dragOrigCropX = cropX; dragOrigCropY = cropY;
    } else {
      resizing = true;
      resizeEdge = edge;
      resizeStartX = pos.x; resizeStartY = pos.y;
      resizeOrigCrop = { x: cropX, y: cropY, w: cropW, h: cropH };
    }
  }

  function onPointerMove(e) {
    var pos = getCanvasPos(e);
    if (dragging) {
      e.preventDefault();
      var dx = pos.x - dragStartX;
      var dy = pos.y - dragStartY;
      cropX = clamp(dragOrigCropX + dx, dispX, dispX + dispW - cropW);
      cropY = clamp(dragOrigCropY + dy, dispY, dispY + dispH - cropH);
      draw();
    } else if (resizing) {
      e.preventDefault();
      doResize(pos);
      draw();
    } else {
      var edge = getEdge(pos);
      setCursor(edge);
    }
  }

  function onPointerUp() {
    dragging = false;
    resizing = false;
    resizeEdge = null;
  }

  function onTouchStart(e) {
    if (e.touches.length !== 1) return;
    var t = e.touches[0];
    var pos = getCanvasPos(t);
    var edge = getEdge(pos);
    if (!edge) return;
    e.preventDefault();
    if (edge === "move") {
      dragging = true;
      dragStartX = pos.x; dragStartY = pos.y;
      dragOrigCropX = cropX; dragOrigCropY = cropY;
    } else {
      resizing = true;
      resizeEdge = edge;
      resizeStartX = pos.x; resizeStartY = pos.y;
      resizeOrigCrop = { x: cropX, y: cropY, w: cropW, h: cropH };
    }
  }

  function onTouchMove(e) {
    if (e.touches.length !== 1) return;
    e.preventDefault();
    var t = e.touches[0];
    var pos = getCanvasPos(t);
    if (dragging) {
      var dx = pos.x - dragStartX;
      var dy = pos.y - dragStartY;
      cropX = clamp(dragOrigCropX + dx, dispX, dispX + dispW - cropW);
      cropY = clamp(dragOrigCropY + dy, dispY, dispY + dispH - cropH);
      draw();
    } else if (resizing) {
      doResize(pos);
      draw();
    }
  }

  function doResize(pos) {
    var ratio = preset.ratio;
    var o = resizeOrigCrop;
    var dx = pos.x - resizeStartX;
    var dy = pos.y - resizeStartY;

    var nx = o.x, ny = o.y, nw = o.w, nh = o.h;

    // For locked aspect ratio, resize based on primary axis
    if (resizeEdge === "br" || resizeEdge === "r" || resizeEdge === "b") {
      if (resizeEdge === "b") { nh = o.h + dy; nw = nh * ratio; }
      else { nw = o.w + dx; nh = nw / ratio; }
    } else if (resizeEdge === "tl" || resizeEdge === "l" || resizeEdge === "t") {
      if (resizeEdge === "t") {
        var newH = o.h - dy;
        var newW = newH * ratio;
        nx = o.x + o.w - newW;
        ny = o.y + o.h - newH;
        nw = newW; nh = newH;
      } else {
        var newW2 = o.w - dx;
        var newH2 = newW2 / ratio;
        nx = o.x + o.w - newW2;
        ny = o.y + o.h - newH2;
        nw = newW2; nh = newH2;
      }
    } else if (resizeEdge === "tr") {
      nw = o.w + dx;
      nh = nw / ratio;
      ny = o.y + o.h - nh;
    } else if (resizeEdge === "bl") {
      nh = o.h + dy;
      nw = nh * ratio;
      nx = o.x + o.w - nw;
    }

    // Enforce minimum
    if (nw < MIN_CROP) { nw = MIN_CROP; nh = nw / ratio; }
    if (nh < MIN_CROP) { nh = MIN_CROP; nw = nh * ratio; }

    // Clamp to image bounds
    if (nx < dispX) { nx = dispX; }
    if (ny < dispY) { ny = dispY; }
    if (nx + nw > dispX + dispW) { nw = dispX + dispW - nx; nh = nw / ratio; }
    if (ny + nh > dispY + dispH) { nh = dispY + dispH - ny; nw = nh * ratio; }

    cropX = nx; cropY = ny; cropW = nw; cropH = nh;
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function doCrop(originalFile) {
    // Crop from original image coordinates
    var sx = Math.round((cropX - dispX) * scale);
    var sy = Math.round((cropY - dispY) * scale);
    var sw = Math.round(cropW * scale);
    var sh = Math.round(cropH * scale);

    // Clamp to image bounds
    sx = Math.max(0, sx);
    sy = Math.max(0, sy);
    if (sx + sw > img.naturalWidth) sw = img.naturalWidth - sx;
    if (sy + sh > img.naturalHeight) sh = img.naturalHeight - sy;

    var outCanvas = document.createElement("canvas");
    outCanvas.width = sw;
    outCanvas.height = sh;
    var outCtx = outCanvas.getContext("2d");
    outCtx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    // Determine output format
    var mimeType = originalFile.type === "image/png" ? "image/png" : "image/jpeg";
    var quality = mimeType === "image/jpeg" ? 0.92 : undefined;

    outCanvas.toBlob(function (blob) {
      cleanup();
      _onConfirm(blob, originalFile);
    }, mimeType, quality);
  }

  function cleanup() {
    if (overlay) { overlay.remove(); overlay = null; }
    canvas = null;
    ctx = null;
    img = null;
    dragging = false;
    resizing = false;
  }

  /**
   * Helper: wraps an existing file input to use the cropper.
   * Call once per input, e.g.:
   *   ImagePreviewCropper.wrap("storefrontBannerFile", "banner", function(blob){ ... });
   *
   * onReady(blob, originalFile) is called when user confirms (crop or original).
   * The file input is reset after.
   */
  function wrap(inputId, type, onReady) {
    var input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener("change", function () {
      var file = input.files && input.files[0];
      if (!file || !file.type.startsWith("image/")) return;
      open(file, {
        type: type,
        onConfirm: function (blob, orig) {
          input.value = "";
          onReady(blob, orig);
        },
        onOriginal: function (orig) {
          input.value = "";
          onReady(orig, orig);
        },
        onCancel: function () {
          input.value = "";
        }
      });
    });
  }

  return { open: open, wrap: wrap, PRESETS: PRESETS };
})();
