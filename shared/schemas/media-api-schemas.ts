import { z } from 'zod'
import {
  ipcResult,
  emptyResult,
  fileFilter,
  updateStateSchema,
  logsResponse,
} from './common-schemas'

export const mediaApiSchemas = {
  readLocalFile: {
    input: z.object({ filePath: z.string() }),
    output: z.object({ data: z.string(), mimeType: z.string() }),
  },
  /**
   * A byte range of a local media file, for the WebCodecs demuxer.
   *
   * It cannot use `fetch('file://…')`: the renderer's CSP allows `file:` for `img-src`
   * and `media-src` but not for `connect-src`, so every demux was blocked and the whole
   * hardware-decode path silently fell back to <video>. Widening `connect-src` would let
   * the renderer read any local file it likes; going through main keeps the fetch off the
   * renderer and puts the read behind `validatePath`.
   *
   * Ranged rather than whole-file so one 4K source cannot put a single multi-hundred-MB
   * message through the IPC channel.
   */
  readMediaChunk: {
    input: z.object({
      filePath: z.string(),
      offset: z.number().int().min(0),
      length: z.number().int().min(1),
    }),
    output: z.object({
      data: z.instanceof(Uint8Array),
      /** Total size of the file, so the caller knows when it is done. */
      totalSize: z.number(),
    }),
  },
  getAppInfo: {
    input: z.object({}),
    output: z.object({ version: z.string(), isPackaged: z.boolean(), userDataPath: z.string() }),
  },
  getSystemFonts: {
    input: z.object({}),
    output: z.object({
      fonts: z.array(z.string()),
    }),
  },

  getNoticesText: {
    input: z.object({}),
    output: z.string(),
  },

  // Auto-update against GitHub Releases. Only meaningful in a packaged build
  // or when KOMFYEDIT_FAKE_UPDATE=1 is set.
  checkForUpdates: {
    input: z.object({}),
    output: updateStateSchema,
  },
  updateGetState: {
    input: z.object({}),
    output: updateStateSchema,
  },
  updateDownload: {
    input: z.object({}),
    output: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },
  updateInstallNow: {
    input: z.object({}),
    output: z.object({
      success: z.boolean(),
      error: z.string().optional(),
    }),
  },

  // Window controls — the native frame is off, so the in-app title bar drives
  // minimise / maximise / close over IPC.
  windowMinimize: {
    input: z.object({}),
    output: z.void(),
  },
  windowToggleMaximize: {
    input: z.object({}),
    output: z.boolean(),
  },
  windowClose: {
    input: z.object({}),
    output: z.void(),
  },
  windowIsMaximized: {
    input: z.object({}),
    output: z.boolean(),
  },

  openExternalUrl: {
    input: z.object({ url: z.string() }),
    output: z.boolean(),
  },
  openParentFolderOfFile: {
    input: z.object({ filePath: z.string() }),
    output: z.void(),
  },
  showItemInFolder: {
    input: z.object({ filePath: z.string() }),
    output: z.void(),
  },
  showNotification: {
    input: z.object({
      title: z.string(),
      body: z.string(),
      filePath: z.string().optional(),
    }),
    output: z.boolean(),
  },

  // Logs
  getLogs: {
    input: z.object({ query: z.string().optional() }),
    output: logsResponse,
  },
  getLogPath: {
    input: z.object({}),
    output: z.object({ logPath: z.string(), logDir: z.string() }),
  },
  openLogFolder: {
    input: z.object({}),
    output: z.boolean(),
  },

  // Paths
  getResourcePath: {
    input: z.object({}),
    output: z.string().nullable(),
  },
  getDownloadsPath: {
    input: z.object({}),
    output: z.string(),
  },

  // Project assets
  addVisualAssetToProject: {
    input: z.object({ srcPath: z.string(), projectId: z.string(), type: z.enum(['video', 'image']) }),
    output: ipcResult({
      path: z.string(),
      bigThumbnailPath: z.string(),
      smallThumbnailPath: z.string(),
      width: z.number(),
      height: z.number(),
    }),
  },
  addGenericAssetToProject: {
    input: z.object({ srcPath: z.string(), projectId: z.string() }),
    output: ipcResult({ path: z.string() }),
  },
  makeThumbnailsForProjectAsset: {
    input: z.object({ path: z.string(), type: z.enum(['video', 'image']) }),
    output: ipcResult({
      bigThumbnailPath: z.string(),
      smallThumbnailPath: z.string(),
    }),
  },
  makeDimensionsForProjectAsset: {
    input: z.object({ path: z.string(), type: z.enum(['video', 'image']) }),
    output: ipcResult({
      width: z.number(),
      height: z.number(),
    }),
  },

  getProjectAssetsPath: {
    input: z.object({}),
    output: z.string(),
  },
  openProjectAssetsPathChangeDialog: {
    input: z.object({}),
    output: ipcResult({ path: z.string() }),
  },

  // File dialogs & save
  showSaveDialog: {
    input: z.object({
      title: z.string().optional(),
      defaultPath: z.string().optional(),
      filters: z.array(fileFilter).optional(),
    }),
    output: z.string().nullable(),
  },
  saveFile: {
    input: z.object({ filePath: z.string(), data: z.string(), encoding: z.string().optional() }),
    output: ipcResult({ path: z.string() }),
  },
  saveBinaryFile: {
    input: z.object({ filePath: z.string(), data: z.instanceof(ArrayBuffer) }),
    output: ipcResult({ path: z.string() }),
  },
  saveTempShapeImage: {
    input: z.object({ clipId: z.string(), data: z.string() }),
    output: ipcResult({ path: z.string() }),
  },
  showOpenDirectoryDialog: {
    input: z.object({ title: z.string().optional() }),
    output: z.string().nullable(),
  },
  searchDirectoryForFiles: {
    input: z.object({ directory: z.string(), filenames: z.array(z.string()) }),
    output: z.record(z.string(), z.string()),
  },
  checkFilesExist: {
    input: z.object({ filePaths: z.array(z.string()) }),
    output: z.record(z.string(), z.boolean()),
  },
  showOpenFileDialog: {
    input: z.object({
      title: z.string().optional(),
      filters: z.array(fileFilter).optional(),
      properties: z.array(z.string()).optional(),
    }),
    output: z.array(z.string()).nullable(),
  },
  getLutContent: {
    input: z.object({ filterId: z.string() }),
    output: ipcResult({ content: z.string().optional() }),
  },

  // Proxy Generation
  generateProxy: {
    input: z.object({
      assetId: z.string(),
      filePath: z.string(),
    }),
    output: ipcResult({
      proxyPath: z.string().optional(),
    }),
  },
  cancelProxy: {
    input: z.object({
      assetId: z.string(),
    }),
    output: emptyResult,
  },
  getProxyStatus: {
    input: z.object({
      assetId: z.string(),
      filePath: z.string().optional(),
    }),
    output: z.object({
      status: z.enum(['none', 'generating', 'ready', 'error']),
      progress: z.number(),
      proxyPath: z.string().optional(),
      error: z.string().optional(),
    }),
  },

  // Logging
  writeLog: {
    input: z.object({ level: z.string(), message: z.string() }),
    output: z.void(),
  },
} as const
