import type { UploadedCoverImage } from './types'

const DB_NAME = 'kailaedit_cover_studio'
const DB_VERSION = 1
const STORE_NAME = 'uploaded_images'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported'))
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function getStoredCoverImages(): Promise<UploadedCoverImage[]> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const request = store.getAll()
      request.onsuccess = () => {
        const list = (request.result as UploadedCoverImage[]) || []
        list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
        resolve(list)
      }
      request.onerror = () => reject(request.error)
    })
  } catch (err) {
    console.warn('IndexedDB unavailable, falling back to localStorage:', err)
    try {
      const raw = localStorage.getItem('kailaedit_cover_uploaded_images')
      const list = raw ? (JSON.parse(raw) as UploadedCoverImage[]) : []
      list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
      return list
    } catch {
      return []
    }
  }
}

export async function saveCoverImage(image: UploadedCoverImage): Promise<void> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.put(image)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn('Failed saving cover image to IndexedDB, fallback to localStorage:', err)
    try {
      const existing = await getStoredCoverImages()
      const filtered = [image, ...existing.filter(i => i.id !== image.id)].slice(0, 30)
      localStorage.setItem('kailaedit_cover_uploaded_images', JSON.stringify(filtered))
    } catch (e) {
      console.error('Failed to save cover image to localStorage:', e)
    }
  }
}

export async function deleteStoredCoverImage(id: string): Promise<void> {
  try {
    const db = await openDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      store.delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    console.warn('Failed deleting cover image from IndexedDB, fallback to localStorage:', err)
    try {
      const raw = localStorage.getItem('kailaedit_cover_uploaded_images')
      if (raw) {
        const list = JSON.parse(raw) as UploadedCoverImage[]
        const updated = list.filter(item => item.id !== id)
        localStorage.setItem('kailaedit_cover_uploaded_images', JSON.stringify(updated))
      }
    } catch (e) {
      console.error('Failed to delete cover image from localStorage:', e)
    }
  }
}
