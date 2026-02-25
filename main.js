const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  dialog,
  clipboard,
  nativeImage,
  Tray,
  Menu,
} = require("electron");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
const os = require("os");
const { autoUpdater } = require("electron-updater");

let mainWindow = null;
let tray = null;
let isPinned = false;
let isVisible = false;
let currentShortcut = null;
let updateInfo = null;
let updateDownloaded = false;

const TEMP_DIR = path.join(os.tmpdir(), "renderdragon-assets-temp");
const CONFIG_DIR = path.join(app.getPath("userData"), "config");
const CONFIG_FILE = path.join(CONFIG_DIR, "settings.json");

// Default shortcuts per platform
const DEFAULT_SHORTCUTS = {
  darwin: "CommandOrControl+Shift+Space",
  win32: "Alt+Space",
  linux: "Alt+Space"
};

function getDefaultShortcut() {
  return DEFAULT_SHORTCUTS[process.platform] || DEFAULT_SHORTCUTS.linux;
}

// Validate Electron accelerator format
function isValidAccelerator(shortcut) {
  // Valid modifiers and keys based on Electron's accelerator syntax
  const modifiers = /^(CommandOrControl|CmdOrCtrl|Command|Cmd|Control|Ctrl|Alt|Option|AltGr|Shift|Super|Meta)$/i;
  const validKeys = /^([\dA-Z]|F[1-9]|F1[0-9]|F2[0-4]|Plus|Space|Tab|Capslock|Numlock|Scrolllock|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|VolumeUp|VolumeDown|VolumeMute|MediaNextTrack|MediaPreviousTrack|MediaStop|MediaPlayPause|PrintScreen|num[0-9]|numdec|numadd|numsub|nummult|numdiv)$/i;

  const parts = shortcut.split("+").map((p) => p.trim());
  if (parts.length === 0 || parts.some((p) => p === "")) return false;

  const keyPart = parts.pop();
  if (!validKeys.test(keyPart)) return false;

  return parts.every((mod) => modifiers.test(mod));
}

// Validate and sanitize settings object
function validateSettings(parsed) {
  const defaults = { shortcut: getDefaultShortcut() };
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return defaults;
  }
  return {
    shortcut:
      typeof parsed.shortcut === "string" && isValidAccelerator(parsed.shortcut)
        ? parsed.shortcut
        : defaults.shortcut,
  };
}

// Settings management
function loadSettings() {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, "utf8");
      const parsed = JSON.parse(data);
      return validateSettings(parsed);
    }
  } catch (err) {
    console.error("Failed to load settings:", err);
  }
  return { shortcut: getDefaultShortcut() };
}

function saveSettings(settings) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(settings, null, 2));
    return true;
  } catch (err) {
    console.error("Failed to save settings:", err);
    return false;
  }
}

function registerShortcut(shortcut) {
  // Unregister current shortcut first
  if (currentShortcut) {
    try {
      globalShortcut.unregister(currentShortcut);
    } catch (e) {
      console.error("Failed to unregister shortcut:", e);
    }
  }

  // Try to register new shortcut
  try {
    const registered = globalShortcut.register(shortcut, () => {
      toggleWindow();
    });

    if (registered) {
      currentShortcut = shortcut;
      console.log(`Registered global shortcut: ${shortcut}`);
      return { success: true, shortcut };
    } else {
      console.error(`Failed to register shortcut: ${shortcut}`);
      // Try to re-register the old shortcut
      if (currentShortcut && currentShortcut !== shortcut) {
        globalShortcut.register(currentShortcut, () => toggleWindow());
      }
      return { success: false, message: "Shortcut may be in use by another application" };
    }
  } catch (err) {
    console.error("Shortcut registration error:", err);
    return { success: false, message: err.message };
  }
}

function cleanTempDir() {
  try {
    if (fs.existsSync(TEMP_DIR)) {
      const files = fs.readdirSync(TEMP_DIR);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(TEMP_DIR, file));
        } catch (e) {
          console.error(`Failed to delete temp file ${file}:`, e);
        }
      }
    } else {
      fs.mkdirSync(TEMP_DIR);
    }
  } catch (err) {
    console.error("Failed to clean/create temp dir:", err);
  }
}

function sanitizeFilename(filename) {
  const base = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const ext = path.extname(base);
  const name = path.basename(base, ext);
  return `${name}_${Date.now()}${ext}`;
}

/**
 * Generate a deterministic cache filename for a given URL and original name.
 * Uses a simple hash of the URL to create a stable filename for caching purposes.
 */
function getCacheFilename(url, originalName) {
  const ext = path.extname(originalName) || '';
  // Simple hash function for the URL
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Use absolute value and convert to base36 for shorter string
  const hashStr = Math.abs(hash).toString(36);
  const sanitizedName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 50);
  const baseName = path.basename(sanitizedName, ext);
  return `${baseName}_${hashStr}${ext}`;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    icon: path.join(__dirname, "icon", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Hide when loses focus (unless pinned)
  mainWindow.on("blur", () => {
    console.log(`Window blurred. isPinned: ${isPinned}, isAlwaysOnTop: ${mainWindow.isAlwaysOnTop()}`);
    if (!isPinned) {
      hideWindow();
    }
  });

  // Prevent window from being destroyed on close - hide to tray instead
  mainWindow.on("close", (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      hideWindow();
    }
  });

  // Center window on screen
  mainWindow.center();
}

function showWindow() {
  console.log("main.js: showWindow() called");
  if (mainWindow) {
    mainWindow.center();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send("window-shown");
    isVisible = true;
    updateTrayMenu();
  }
}

function hideWindow() {
  console.log("main.js: hideWindow() called");
  if (mainWindow) {
    mainWindow.hide();
    mainWindow.webContents.send("window-hidden");
    isVisible = false;
    updateTrayMenu();
  }
}

function toggleWindow() {
  if (isVisible) {
    hideWindow();
  } else {
    showWindow();
  }
}

function createTray() {
  // Use the existing icon - use app.getAppPath() for packaged apps
  const iconPath = path.join(app.getAppPath(), "icon", "icon.png");

  // Create tray icon - resize for system tray (16x16 on most platforms)
  let trayIcon = nativeImage.createFromPath(iconPath);

  // Resize for tray (16x16 is standard for Windows/Linux, macOS uses 22x22 but handles scaling)
  if (process.platform === "win32" || process.platform === "linux") {
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  } else if (process.platform === "darwin") {
    trayIcon = trayIcon.resize({ width: 22, height: 22 });
    trayIcon.setTemplateImage(true); // Makes it adapt to dark/light menu bar on macOS
  }

  tray = new Tray(trayIcon);
  tray.setToolTip("RenderDragon Assets");

  // Create context menu
  const contextMenu = Menu.buildFromTemplate([
    {
      label: isVisible ? "Hide" : "Show",
      click: () => {
        toggleWindow();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Single click on tray icon toggles window (Windows/Linux)
  tray.on("click", () => {
    toggleWindow();
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: isVisible ? "Hide" : "Show",
      click: () => {
        toggleWindow();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

// ===== Auto Update =====
function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    console.log("Checking for updates...");
    sendUpdateStatus({ status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    console.log("Update available:", info.version);
    updateInfo = info;
    sendUpdateStatus({
      status: "available",
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    console.log("No updates available");
    sendUpdateStatus({ status: "not-available", version: info.version });
  });

  autoUpdater.on("download-progress", (progress) => {
    console.log(`Download progress: ${progress.percent}%`);
    sendUpdateStatus({
      status: "downloading",
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("Update downloaded:", info.version);
    updateDownloaded = true;
    sendUpdateStatus({
      status: "downloaded",
      version: info.version,
    });
  });

  autoUpdater.on("error", (error) => {
    console.error("Update error:", error);
    sendUpdateStatus({
      status: "error",
      message: error.message,
    });
  });
}

function sendUpdateStatus(data) {
  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send("update-status", data);
  }
}

async function checkForUpdates(silent = false) {
  try {
    if (!silent) {
      sendUpdateStatus({ status: "checking" });
    }
    await autoUpdater.checkForUpdates();
  } catch (error) {
    console.error("Check for updates error:", error);
    if (!silent) {
      sendUpdateStatus({
        status: "error",
        message: error.message,
      });
    }
  }
}

async function downloadUpdate() {
  try {
    sendUpdateStatus({ status: "downloading", percent: 0 });
    await autoUpdater.downloadUpdate();
  } catch (error) {
    console.error("Download update error:", error);
    sendUpdateStatus({
      status: "error",
      message: error.message,
    });
  }
}

function quitAndInstall() {
  if (updateDownloaded) {
    setImmediate(() => {
      app.removeAllListeners("window-all-closed");
      if (tray) {
        tray.destroy();
        tray = null;
      }
      autoUpdater.quitAndInstall(false, true);
    });
  }
}

// Helper function to download file to path
function downloadToFile(url, filepath, options = {}) {
  const { timeout = 30000, maxSizeBytes = 500 * 1024 * 1024 } = options;

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const request = protocol.get(url, (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return reject(new Error(`HTTP status code ${response.statusCode}`));
      }

      const contentLength = parseInt(response.headers["content-length"], 10);
      if (!isNaN(contentLength) && contentLength > maxSizeBytes) {
        return reject(
          new Error(
            `File size (${contentLength} bytes) exceeds limit of ${maxSizeBytes} bytes`,
          ),
        );
      }

      const file = fs.createWriteStream(filepath);
      let receivedBytes = 0;

      let rejected = false;
      response.on("data", (chunk) => {
        receivedBytes += chunk.length;
        if (!rejected && receivedBytes > maxSizeBytes) {
          rejected = true;
          response.destroy();
          file.close(() => {
            fs.unlink(filepath, () => { });
          });
          reject(new Error(`File size exceeds limit of ${maxSizeBytes} bytes`));
        }
      });

      response.pipe(file);

      file.on("finish", () => {
        file.close();
        resolve({ success: true, path: filepath });
      });

      file.on("error", (err) => {
        fs.unlink(filepath, () => { });
        reject(err);
      });
    });

    request.on("timeout", () => {
      request.destroy();
      fs.unlink(filepath, () => { });
      reject(new Error("Request timed out"));
    });

    request.on("error", (err) => {
      fs.unlink(filepath, () => { });
      reject(err);
    });

    if (timeout) {
      request.setTimeout(timeout);
    }
  });
}

// Helper function to copy file to clipboard
function copyFileToClipboard(filePath) {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      const { exec } = require("child_process");
      // Use PowerShell to set file drop list
      // Using single quotes for path in PowerShell requires escaping single quotes as ''
      const safePath = filePath.replace(/'/g, "''");
      const psScript = `
                Add-Type -AssemblyName System.Windows.Forms;
                [System.Collections.Specialized.StringCollection]$files = New-Object System.Collections.Specialized.StringCollection;
                $files.Add('${safePath}');
                [System.Windows.Forms.Clipboard]::SetFileDropList($files);
            `;
      // Encode command to avoid issues with special characters
      const encodedCommand = Buffer.from(psScript, "utf16le").toString(
        "base64",
      );
      exec(
        `powershell -EncodedCommand ${encodedCommand}`,
        { timeout: 10000 },
        (error) => {
          if (error) {
            console.error("PowerShell error:", error);
            resolve({ success: false, message: error.message });
          } else {
            resolve({ success: true, type: "file", path: filePath });
          }
        },
      );
    } else if (process.platform === "darwin") {
      const { execFile } = require("child_process");
      // Use Objective-C bridge to set NSFilenamesPboardType
      // which Finder needs to recognize the file for Cmd+V paste
      const script = `
        use framework "AppKit"
        on run argv
          set thePath to item 1 of argv
          set pb to current application's NSPasteboard's generalPasteboard()
          pb's clearContents()
          pb's declareTypes:{current application's NSFilenamesPboardType} owner:(missing value)
          pb's setPropertyList:{thePath} forType:(current application's NSFilenamesPboardType)
        end run
      `;

      execFile("osascript", ["-e", script, filePath], { timeout: 10000 }, (error) => {
        if (error) {
          console.error("AppleScript/ObjC error:", error);
          // Fallback: set clipboard to POSIX file as alias
          const fallbackScript = `on run argv
            set the clipboard to (POSIX file (item 1 of argv)) as alias
          end run`;
          execFile("osascript", ["-e", fallbackScript, filePath], { timeout: 10000 }, (fallbackError) => {
            if (fallbackError) {
              console.error("Fallback AppleScript error:", fallbackError);
              clipboard.writeText(filePath);
              resolve({ success: true, type: "text", path: filePath, message: "Copied file path as text" });
            } else {
              resolve({ success: true, type: "file", path: filePath });
            }
          });
        } else {
          resolve({ success: true, type: "file", path: filePath });
        }
      });
    } else {
      // Linux and others - Try to set text/uri-list
      try {
        // Write to clipboard as text/uri-list and plain text together
        const uriList = Buffer.from(`file://${filePath}\r\n`);
        clipboard.write({
          "text/uri-list": uriList,
          text: filePath,
        });

        resolve({ success: true, type: "file", path: filePath });
      } catch (err) {
        resolve({ success: false, message: err.message });
      }
    }
  });
}

app.whenReady().then(() => {
  cleanTempDir();
  createWindow();
  createTray();

  // Setup auto-updater
  setupAutoUpdater();

  // Check for updates on startup (silent)
  if (app.isPackaged) {
    setTimeout(() => checkForUpdates(true), 3000);
  }

  // Load settings and register global shortcut
  const settings = loadSettings();
  const shortcutToRegister = settings.shortcut || getDefaultShortcut();
  const result = registerShortcut(shortcutToRegister);

  if (!result.success) {
    console.error("Failed to register global shortcut, trying default");
    registerShortcut(getDefaultShortcut());
  }

  // IPC handlers
  ipcMain.handle("set-always-on-top", (event, value) => {
    if (mainWindow) {
      console.log(`Setting always-on-top to ${value}`);
      mainWindow.setAlwaysOnTop(value, 'pop-up-menu');
      mainWindow.setVisibleOnAllWorkspaces(value, { visibleOnFullScreen: true });
      return { success: true };
    }
    return { success: false };
  });

  ipcMain.handle("set-pinned", (event, value) => {
    console.log(`Setting isPinned to ${value}`);
    isPinned = value;
    if (mainWindow) {
      mainWindow.setVisibleOnAllWorkspaces(value, { visibleOnFullScreen: true });
    }
    return { success: true };
  });

  ipcMain.handle("hide-window", () => {
    hideWindow();
  });

  ipcMain.handle("download-asset", async (event, url, filename) => {
    try {
      const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: filename,
        filters: [{ name: "All Files", extensions: ["*"] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, message: "Download canceled" };
      }

      try {
        await downloadToFile(url, result.filePath);
        return { success: true, path: result.filePath };
      } catch (err) {
        return { success: false, message: err.message };
      }
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  // Copy to clipboard handler
  ipcMain.handle("copy-to-clipboard", async (event, url, filename, ext) => {
    try {
      const cleanFilename = sanitizeFilename(filename);
      const tempPath = path.join(TEMP_DIR, cleanFilename);

      // Download to file directly
      await downloadToFile(url, tempPath);

      // Verify the temp file actually exists before copying
      if (!fs.existsSync(tempPath)) {
        return { success: false, message: "Downloaded file not found" };
      }

      // Copy file to clipboard (always as file drop for all types)
      return await copyFileToClipboard(tempPath);
    } catch (error) {
      return { success: false, message: error.message };
    }
  });

  ipcMain.on("start-drag", async (event, url, filename) => {
    try {
      const cacheFilename = getCacheFilename(url, filename);
      const tempPath = path.join(TEMP_DIR, cacheFilename);
      const iconPath = path.join(__dirname, "icon", "icon.png");

      if (!fs.existsSync(tempPath)) {
        await downloadToFile(url, tempPath);
      }

      event.sender.startDrag({
        file: tempPath,
        icon: iconPath,
      });
    } catch (err) {
      console.error("Drag error:", err);
    }
  });

  // Keybind management handlers
  ipcMain.handle("get-shortcut", () => {
    const settings = loadSettings();
    return {
      shortcut: currentShortcut || settings.shortcut || getDefaultShortcut(),
      defaultShortcut: getDefaultShortcut(),
      platform: process.platform
    };
  });

  ipcMain.handle("set-shortcut", async (event, newShortcut) => {
    if (!newShortcut || typeof newShortcut !== "string") {
      return { success: false, message: "Invalid shortcut format" };
    }

    if (!isValidAccelerator(newShortcut)) {
      return { success: false, message: "Invalid accelerator format. Use modifiers like Ctrl, Alt, Shift with a key (e.g., Ctrl+Shift+P)" };
    }

    const result = registerShortcut(newShortcut);
    if (result.success) {
      const settings = loadSettings();
      settings.shortcut = newShortcut;
      saveSettings(settings);
    }
    return result;
  });

  ipcMain.handle("reset-shortcut", async () => {
    const defaultShortcut = getDefaultShortcut();
    const result = registerShortcut(defaultShortcut);
    if (result.success) {
      const settings = loadSettings();
      settings.shortcut = defaultShortcut;
      saveSettings(settings);
    }
    return result;
  });

  // Auto-update handlers
  ipcMain.handle("check-for-updates", async () => {
    await checkForUpdates(false);
    return { success: true };
  });

  ipcMain.handle("download-update", async () => {
    await downloadUpdate();
    return { success: true };
  });

  ipcMain.handle("quit-and-install", () => {
    quitAndInstall();
    return { success: true };
  });

  ipcMain.handle("get-app-version", () => {
    return {
      version: app.getVersion(),
      isPackaged: app.isPackaged
    };
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
});

app.on("will-quit", () => {
  cleanTempDir();
  globalShortcut.unregisterAll();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on("window-all-closed", () => {
  // Don't quit when windows are closed - keep running in tray
  // App can only be quit via tray menu or Cmd+Q on macOS
});
