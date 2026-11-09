import 'source-map-support/register';

import { join } from 'node:path';

import { electronApp, is, optimizer } from '@electron-toolkit/utils';
import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron';

import icon from '../../resources/icon.png?asset';
import actions from './actions';
import { appLog } from './core/appLog';
import { ImageRoute } from './core/routes';
import { enableTurntableSerial } from './core/serial';
import { shutdownStopMoCameraHelper, startStopMoCameraHelper } from './core/stopmoCamera';
import { shutdownToucanCameraServer } from './core/toucan';

let sendToRenderer = () => null;

appLog(`--- StopMo ${app.getVersion()} starting: ${process.platform} ${process.arch}, electron ${process.versions.electron}, ${app.getAppPath()}`);
process.on('uncaughtException', (err) => appLog('uncaught exception in main:', err));
process.on('unhandledRejection', (err) => appLog('unhandled rejection in main:', err instanceof Error ? err : String(err)));
process.on('exit', (code) => appLog(`main process exit ${code}`));
app.on('render-process-gone', (_, __, details) => appLog('renderer gone:', details));
app.on('child-process-gone', (_, details) => appLog('child process gone:', details));
app.on('will-quit', () => appLog('will-quit'));

protocol.registerSchemesAsPrivileged([{ scheme: 'ea', privileges: { bypassCSP: true, corsEnabled: true, standard: true, secure: true, supportFetchAPI: true } }]);

function createWindow() {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 640,
    minHeight: 360,
    title: 'Eagle Animation by Brick à Brack',
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      webSecurity: true,
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
    },
  });

  mainWindow.on('ready-to-show', () => {
    appLog('window ready, showing');
    mainWindow.show();
  });
  mainWindow.webContents.on('did-fail-load', (_, code, desc) => appLog(`renderer failed to load: ${code} ${desc}`));
  mainWindow.webContents.on('console-message', (event) => {
    if (event.level === 'error') {
      appLog(`renderer error: ${event.message}`);
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  sendToRenderer = (channel, value) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, value);
    }
  };
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron');

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // Register custom protocol for image processing
  protocol.handle('ea', ImageRoute);

  enableTurntableSerial();

  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || is.dev) {
    app.quit();
  }
});

// Make sure the toucan camera server is killed before Electron exits,
// otherwise it keeps holding the webcam handle (visible as an active
// camera indicator in the parent terminal / VS Code).
app.on('before-quit', () => {
  appLog('before-quit');
  shutdownToucanCameraServer();
  shutdownStopMoCameraHelper();
});

// The Canon 5D Mark II helper runs for the whole session so the body stays awake and tethered
app.whenReady().then(() => startStopMoCameraHelper());

const handleTerminationSignal = (signal) => {
  appLog(`received ${signal}`);
  shutdownToucanCameraServer();
  shutdownStopMoCameraHelper();
  app.quit();
  // Give Electron a moment to tear down, then force-exit if needed.
  setTimeout(() => process.exit(signal === 'SIGINT' ? 130 : 143), 1500).unref?.();
};
process.on('SIGINT', () => handleTerminationSignal('SIGINT'));
process.on('SIGTERM', () => handleTerminationSignal('SIGTERM'));

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
app.whenReady().then(() => {
  Object.keys(actions).forEach((name) => {
    ipcMain.handle(name, (evt, args) => {
      return actions[name](evt, args, sendToRenderer);
    });
  });
});
