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

// ProseMirror (TipTap) measures layout; jsdom has none, so stub the geometry APIs it calls.
const emptyRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
const noRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
if (typeof Range !== 'undefined') {
  Range.prototype.getBoundingClientRect ??= emptyRect;
  Range.prototype.getClientRects ??= noRects;
}
if (typeof Element !== 'undefined') Element.prototype.getClientRects ??= noRects;
if (typeof document !== 'undefined') document.elementFromPoint ??= () => null;
