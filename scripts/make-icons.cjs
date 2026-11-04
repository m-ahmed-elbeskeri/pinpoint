const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'build', 'icon.svg'), 'utf8');

// One icon image as a BMP: a 40-byte header, bottom-up BGRA rows, then an all-clear AND mask.
function bmpEntry(img, size) {
  const bgra = img.resize({ width: size, height: size, quality: 'best' }).toBitmap();
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // the colour rows and the mask rows together
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const rows = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) bgra.copy(rows, (size - 1 - y) * size * 4, y * size * 4, (y + 1) * size * 4);
  const maskRow = Math.ceil(size / 32) * 4;
  return Buffer.concat([header, rows, Buffer.alloc(maskRow * size)]);
}

function toIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o); dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, useContentSize: true, transparent: true, frame: false,
    webPreferences: { offscreen: true } });
  win.webContents.setZoomFactor(1);
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', '<svg width="1024" height="1024" ')}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  let img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  if (img.getSize().width !== 1024) img = img.resize({ width: 1024, height: 1024, quality: 'best' });

  fs.writeFileSync(path.join(root, 'build', 'icon.png'), img.toPNG());
  fs.writeFileSync(path.join(root, 'electron', 'icon.png'), img.resize({ width: 512, height: 512, quality: 'best' }).toPNG());
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const ico = toIco(sizes.map((s) => ({ size: s, data: s >= 256 ? img.resize({ width: s, height: s, quality: 'best' }).toPNG() : bmpEntry(img, s) })));
  fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico);
  fs.writeFileSync(path.join(root, 'electron', 'icon.ico'), ico);
  console.log('icons written:', img.getSize());
  app.quit();
});
