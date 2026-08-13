import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const CONFIG_PATH = join(app.getPath('userData'), 'config.json')

interface AppConfig {
  apiBaseUrl: string
}

const DEFAULT_CONFIG: AppConfig = { apiBaseUrl: 'http://localhost:8000' }

function readConfig(): AppConfig {
  if (!existsSync(CONFIG_PATH)) return DEFAULT_CONFIG
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) }
  } catch {
    return DEFAULT_CONFIG
  }
}

function writeConfig(config: AppConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  ipcMain.handle('config:get', () => readConfig())
  ipcMain.handle('config:set', (_event, config: AppConfig) => {
    writeConfig(config)
    return readConfig()
  })
  ipcMain.handle('dialog:elegirArchivoExcel', async () => {
    const resultado = await dialog.showOpenDialog({
      title: 'Localizar archivo Excel OC-MP',
      properties: ['openFile'],
      filters: [{ name: 'Excel', extensions: ['xlsx', 'xlsm'] }]
    })
    if (resultado.canceled || resultado.filePaths.length === 0) return null
    return resultado.filePaths[0]
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
