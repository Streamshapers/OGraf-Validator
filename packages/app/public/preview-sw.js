/**
 * OGraf Validator – Preview Service Worker
 *
 * Intercepts fetch requests to /__ograf_preview__/* and serves the files
 * from the user's local FileSystemDirectoryHandle via BroadcastChannel.
 */

const PREVIEW_PREFIX = '/__ograf_preview__/'
const CHANNEL_NAME = 'ograf-preview'
const REQUEST_TIMEOUT_MS = 8000

// Take control immediately without waiting for page refresh
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

const broadcast = new BroadcastChannel(CHANNEL_NAME)

/** Pending file requests: id → { resolve, reject } */
const pending = new Map()

broadcast.addEventListener('message', (event) => {
  if (event.data?.type !== 'FILE_RESPONSE') return
  const { id, buffer, mimeType, error } = event.data
  const handler = pending.get(id)
  if (!handler) return
  pending.delete(id)
  if (error) {
    handler.reject(new Error(error))
  } else {
    handler.resolve({ buffer, mimeType })
  }
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (!url.pathname.startsWith(PREVIEW_PREFIX)) return
  event.respondWith(servePreviewFile(url))
})

async function servePreviewFile(url) {
  // Strip prefix and query string to get the relative file path
  const path = url.pathname.slice(PREVIEW_PREFIX.length)
  if (!path) return new Response('Not Found', { status: 404 })

  const id = crypto.randomUUID()

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve(new Response(`Preview SW: timeout fetching "${path}"`, { status: 504 }))
    }, REQUEST_TIMEOUT_MS)

    pending.set(id, {
      resolve: ({ buffer, mimeType }) => {
        clearTimeout(timer)
        resolve(
          new Response(buffer, {
            status: 200,
            headers: {
              'Content-Type': mimeType,
              'Cache-Control': 'no-store',
            },
          }),
        )
      },
      reject: (err) => {
        clearTimeout(timer)
        resolve(new Response(`Preview SW: ${err.message}`, { status: 404 }))
      },
    })

    broadcast.postMessage({ type: 'FILE_REQUEST', id, path })
  })
}
