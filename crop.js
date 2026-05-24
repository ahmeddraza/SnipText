const canvas = document.getElementById("screenshotCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const confirmBtn = document.getElementById("confirmBtn");
const cancelBtn = document.getElementById("cancelBtn");
const statusEl = document.getElementById("status");
const progressTextEl = document.getElementById("progressText");
const emptyState = document.getElementById("emptyState");
const hintEl = document.getElementById("hint");
const successToast = document.getElementById("successToast");

const image = new Image();
let selection = null;
let dragStart = null;
let isDragging = false;
let isOcrRunning = false;
let animationFrame = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  hintEl.textContent = message;
  hintEl.classList.toggle("error", isError);
}

function setProgress(progress) {
  const safeProgress = Math.max(0, Math.min(1, progress || 0));
  progressTextEl.hidden = false;
  progressTextEl.textContent = `${Math.round(safeProgress * 100)}%`;
}

function setProcessing(isProcessing) {
  isOcrRunning = isProcessing;
  document.body.classList.toggle("ocr-running", isProcessing);
  progressTextEl.hidden = !isProcessing;
  updateButtonStates();
}

function showSuccessToast() {
  successToast.hidden = false;
  successToast.classList.remove("toast-out");

  window.setTimeout(() => {
    successToast.classList.add("toast-out");
  }, 1700);

  window.setTimeout(() => {
    successToast.hidden = true;
    successToast.classList.remove("toast-out");
  }, 2200);
}

function normalizeRect(rect) {
  const x = Math.min(rect.x, rect.x + rect.width);
  const y = Math.min(rect.y, rect.y + rect.height);
  const width = Math.abs(rect.width);
  const height = Math.abs(rect.height);
  return { x, y, width, height };
}

function hasUsableSelection() {
  if (!selection) {
    return false;
  }

  const rect = normalizeRect(selection);
  return rect.width >= 8 && rect.height >= 8;
}

function updateButtonStates() {
  confirmBtn.disabled = !hasUsableSelection() || isOcrRunning;
}

function drawCanvas() {
  if (!image.complete || !image.naturalWidth) {
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  if (!selection) {
    return;
  }

  const rect = normalizeRect(selection);
  const dashOffset = -(performance.now() / 32);

  ctx.save();
  ctx.fillStyle = "rgba(2, 6, 14, 0.62)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
  ctx.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    rect.x,
    rect.y,
    rect.width,
    rect.height
  );

  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = Math.max(2, canvas.width / 900);
  ctx.setLineDash([12, 8]);
  ctx.lineDashOffset = dashOffset;
  ctx.shadowColor = "rgba(34, 197, 94, 0.55)";
  ctx.shadowBlur = 16;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);

  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(34, 197, 94, 0.9)";
  ctx.shadowBlur = 0;
  ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
  ctx.restore();
}

function startSelectionAnimation() {
  if (animationFrame) {
    return;
  }

  const tick = () => {
    drawCanvas();
    animationFrame = selection ? requestAnimationFrame(tick) : null;
  };

  animationFrame = requestAnimationFrame(tick);
}

function stopSelectionAnimation() {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
  }
}

function canvasPoint(event) {
  const bounds = canvas.getBoundingClientRect();

  // The canvas is responsive, so pointer coordinates must be converted back
  // to the screenshot's real pixel coordinates before cropping.
  const scaleX = canvas.width / bounds.width;
  const scaleY = canvas.height / bounds.height;

  return {
    x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * scaleX)),
    y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * scaleY))
  };
}

function createCroppedDataUrl() {
  const rect = normalizeRect(selection);
  const cropCanvas = document.createElement("canvas");
  const cropCtx = cropCanvas.getContext("2d");

  // Crop from the original screenshot, not from the darkened preview overlay.
  cropCanvas.width = Math.round(rect.width);
  cropCanvas.height = Math.round(rect.height);
  cropCtx.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    cropCanvas.width,
    cropCanvas.height
  );

  return cropCanvas.toDataURL("image/png");
}

function cleanText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

async function copyTextToClipboard(text) {
  const cleaned = cleanText(text);

  if (!cleaned) {
    throw new Error("No readable text found in the selected area.");
  }

  // Clipboard copy happens locally; screenshots and text are never uploaded.
  await navigator.clipboard.writeText(cleaned);
}

async function runOcr() {
  if (!hasUsableSelection()) {
    setStatus("Select an area first", true);
    return;
  }

  setProcessing(true);
  setProgress(0);
  setStatus("Copied to clipboard");
  showSuccessToast();

  try {
    const croppedImage = createCroppedDataUrl();

    // Tesseract runs from local files in libs/. No backend or external API.
    const result = await Tesseract.recognize(croppedImage, "eng", {
      workerPath: chrome.runtime.getURL("libs/worker.min.js"),
      workerBlobURL: false,
      corePath: chrome.runtime.getURL("libs/tesseract-core"),
      langPath: chrome.runtime.getURL("libs/lang"),
      logger(message) {
        if (typeof message.progress === "number") {
          setProgress(message.progress);
        }
      }
    });

    await copyTextToClipboard(result.data.text);
    setProcessing(false);
    setProgress(1);
    setStatus("Copied to clipboard");
  } catch (error) {
    console.error(error);
    setProcessing(false);
    setStatus(error?.message || "OCR failed. Try another selection.", true);
  }
}

function resetSelection(message = "Drag to select text") {
  selection = null;
  dragStart = null;
  isDragging = false;
  stopSelectionAnimation();
  setStatus(message);
  drawCanvas();
  updateButtonStates();
}

canvas.addEventListener("pointerdown", (event) => {
  if (isOcrRunning || !image.complete || !image.naturalWidth) {
    return;
  }

  canvas.setPointerCapture(event.pointerId);
  dragStart = canvasPoint(event);
  selection = { x: dragStart.x, y: dragStart.y, width: 0, height: 0 };
  isDragging = true;
  setStatus("Selecting...");
  startSelectionAnimation();
  drawCanvas();
});

canvas.addEventListener("pointermove", (event) => {
  if (!isDragging || !dragStart) {
    return;
  }

  const point = canvasPoint(event);
  selection = {
    x: dragStart.x,
    y: dragStart.y,
    width: point.x - dragStart.x,
    height: point.y - dragStart.y
  };

  drawCanvas();
  updateButtonStates();
});

canvas.addEventListener("pointerup", (event) => {
  if (!isDragging) {
    return;
  }

  canvas.releasePointerCapture(event.pointerId);
  isDragging = false;
  selection = hasUsableSelection() ? normalizeRect(selection) : null;

  if (selection) {
    setStatus("Ready to extract");
    startSelectionAnimation();
  } else {
    resetSelection("Select a larger area");
  }

  drawCanvas();
  updateButtonStates();
});

canvas.addEventListener("pointercancel", () => resetSelection());

confirmBtn.addEventListener("click", runOcr);

cancelBtn.addEventListener("click", async () => {
  const currentTab = await chrome.tabs.getCurrent();

  if (currentTab?.id) {
    await chrome.tabs.remove(currentTab.id);
  } else {
    window.close();
  }
});

async function loadScreenshot() {
  const { latestScreenshot } = await chrome.storage.local.get("latestScreenshot");

  if (!latestScreenshot) {
    canvas.hidden = true;
    emptyState.hidden = false;
    setStatus("No screenshot found", true);
    updateButtonStates();
    return;
  }

  image.onload = () => {
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.hidden = false;
    emptyState.hidden = true;
    drawCanvas();
    setStatus("Drag to select text");
    updateButtonStates();
  };

  image.onerror = () => {
    canvas.hidden = true;
    emptyState.hidden = false;
    setStatus("Could not load screenshot", true);
    updateButtonStates();
  };

  image.src = latestScreenshot;
}

loadScreenshot();
