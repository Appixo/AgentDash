// Singleton socket.io client.
//
// Next.js may double-mount components in dev (StrictMode) and re-render often,
// so we keep a single connection per browser tab and let consumers subscribe.

import { io } from 'socket.io-client';

let socket;

export const getSocket = () => {
  if (typeof window === 'undefined') return null;

  if (!socket) {
    const url = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000';
    socket = io(url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
    });
  }
  return socket;
};
