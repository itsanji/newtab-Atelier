export function notify(message: string): void {
  void chrome.notifications.create(crypto.randomUUID(), {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: 'Atelier',
    message,
  });
}
