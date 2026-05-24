const captureBtn = document.getElementById("captureBtn");
const statusEl = document.getElementById("status");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function captureErrorMessage(error) {
  const message = error?.message || String(error);

  if (message.includes("Cannot access")) {
    return "Chrome does not allow screenshots on this page. Try a regular website tab.";
  }

  return "Screenshot capture failed. Refresh the page and try again.";
}

captureBtn.addEventListener("click", async () => {
  captureBtn.disabled = true;
  setStatus("Capturing visible tab...", false);

  try {
    // captureVisibleTab only runs after the user clicks the extension popup.
    const screenshot = await chrome.tabs.captureVisibleTab(undefined, {
      format: "png"
    });

    // Store the screenshot locally so crop.html can read it in the new tab.
    await chrome.storage.local.set({
      latestScreenshot: screenshot,
      latestScreenshotCapturedAt: new Date().toISOString()
    });

    // Open the crop screen from this extension package.
    await chrome.tabs.create({
      url: chrome.runtime.getURL("crop.html")
    });

    window.close();
  } catch (error) {
    console.error(error);
    setStatus(captureErrorMessage(error), true);
    captureBtn.disabled = false;
  }
});
