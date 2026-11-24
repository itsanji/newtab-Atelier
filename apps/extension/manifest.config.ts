import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: 'Atelier',
  version: '0.0.1',
  description: 'A tab board for your new tab.',
  icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
  permissions: ['tabs', 'tabGroups', 'storage', 'unlimitedStorage', 'contextMenus', 'alarms', 'notifications', 'favicon'],
  chrome_url_overrides: { newtab: 'src/newtab/index.html' },
  action: { default_popup: 'src/popup/index.html', default_title: 'Atelier',
    default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
  },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  commands: {
    'save-current-tab': {
      suggested_key: { default: 'Alt+Shift+S' },
      description: 'Save the current tab',
    },
  },
});
