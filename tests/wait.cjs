const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function started(electron, ms = 40000) {
  const { BrowserWindow, webContents } = electron;
  let calm = 0;
  for (let t = 0; t < ms; t += 250) {
    await sleep(250);
    const win = BrowserWindow.getAllWindows()[0];
    if (!win || win.webContents.isLoading()) { calm = 0; continue; }
    let mounted = false;
    try { mounted = await win.webContents.executeJavaScript(`!!document.querySelector('.topbar')`); } catch { mounted = false; }
    const guests = webContents.getAllWebContents().filter((w) => w.getType() === 'webview');
    const busy = guests.some((g) => g.isLoading());
    calm = mounted && !busy && t >= 1500 ? calm + 1 : 0;
    if (calm >= 4) return win;
  }
  return BrowserWindow.getAllWindows()[0];
}

const poll = (ui, step = 300) => async (code, ms) => {
  for (let t = 0; t < ms; t += step) {
    let v = null;
    try { v = await ui(code); } catch { v = null; }
    if (v) return v;
    await sleep(step);
  }
  return null;
};

const pollFn = (step = 300) => async (fn, ms) => {
  for (let t = 0; t < ms; t += step) {
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    await sleep(step);
  }
  return null;
};

module.exports = { sleep, started, poll, pollFn };
