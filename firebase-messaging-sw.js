// Firebase Cloud Messaging 백그라운드(앱이 꺼져있을 때) 알림 처리용 서비스 워커

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// index.html의 firebaseConfig와 동일한 값을 넣어주세요
firebase.initializeApp({
  apiKey: "AIzaSyCG59MGXRXNTgzTrSCjsOpzJqWqYm7YFn8",
  authDomain: "mydesk-19280.firebaseapp.com",
  projectId: "mydesk-19280",
  storageBucket: "mydesk-19280.firebasestorage.app",
  messagingSenderId: "1061055723564",
  appId: "1:1061055723564:web:7ee90a969a8f3a2d47b989"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || '리마인더';
  const options = {
    body: payload.notification?.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: payload.data?.reminderId || 'mydesk-reminder',
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('./'));
});
