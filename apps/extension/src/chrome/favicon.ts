export function faviconUrl(pageUrl: string, size = 32): string {
  return chrome.runtime.getURL('/_favicon/') + '?pageUrl=' + encodeURIComponent(pageUrl) + '&size=' + size;
}
