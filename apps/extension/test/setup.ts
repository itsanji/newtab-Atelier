import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// jsdom lacks HTMLDialogElement.showModal/close; provide a minimal polyfill.
const proto = globalThis.HTMLDialogElement?.prototype;
if (proto) {
  proto.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.show ??= function show(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
