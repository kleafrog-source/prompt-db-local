const WS_URL = 'ws://127.0.0.1:3001';

const withSocket = (handler) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(WS_URL);
    let settled = false;

    const finish = (callback) => (value) => {
      if (settled) {
        return;
      }

      settled = true;
      callback(value);
      socket.close();
    };

    socket.addEventListener('open', () => {
      handler(socket, finish(resolve), finish(reject));
    });

    socket.addEventListener('error', () => {
      finish(reject)(new Error('Unable to reach local Electron app on port 3001.'));
    });
  });

const sendToDesktopApp = (payload) =>
  withSocket((socket, resolve) => {
    socket.send(
      JSON.stringify({
        source: 'producer.ai-extension',
        payload,
      }),
    );
    resolve();
  });

const pingDesktopApp = () =>
  withSocket((_socket, resolve) => {
    resolve({
      ok: true,
      wsUrl: WS_URL,
    });
  });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'PING_LOCAL_APP') {
    pingDesktopApp()
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type !== 'FORWARD_TO_LOCAL_APP') {
    return false;
  }

  sendToDesktopApp(message.payload)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
