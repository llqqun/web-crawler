const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { initialize, enable } = require('@electron/remote/main');

initialize();

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    }
  });

  enable(win.webContents);
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 处理爬虫任务
ipcMain.on('start-crawler', async (event, tasks) => {
  const { crawlImages } = require('./crawler-puppeteer');
  for (const task of tasks) {
    try {
      await crawlImages(task.url, task.selector);
      event.reply('task-complete', { url: task.url, status: 'success' });
    } catch (error) {
      event.reply('task-complete', { url: task.url, status: 'failed', error: error.message });
    }
  }
});