const CACHE_NAME = 'spendsmart-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/style.css',
  '/script.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js'
];

// --- 1. Installation: Cache essential files ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('Service Worker: Caching Assets');
      return cache.addAll(ASSETS);
    })
  );
  // Force the waiting service worker to become the active service worker
  self.skipWaiting();
});

// --- 2. Activation: Clean up old caches ---
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('Service Worker: Clearing Old Cache');
            return caches.delete(cache);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// --- 3. Fetch: Serve from cache if offline ---
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});

// --- 4. Push: Handle incoming notifications ---
self.addEventListener('push', (event) => {
  let data = { title: 'Spend Smart', body: 'Time to log your daily expenses!' };

  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    console.error("Push data parse error (expected JSON):", e);
    // Fallback if the data sent wasn't valid JSON
    data = { title: 'Spend Smart', body: event.data.text() };
  }

  const options = {
    body: data.body,
    icon: 'https://cdn-icons-png.flaticon.com/512/2933/2933116.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/2933/2933116.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '1'
    }
  };

  event.waitUntil(
    // FIXED: Correctly using self.registration
    self.registration.showNotification(data.title, options)
  );
});

// --- 5. Notification Click: Open the app ---
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});