import { escapeHtml } from '../share/page';

const CSS = `
:root{--canvas:#f6f1e7;--canvas-raised:#fbf8f2;--line:#ddd3c1;--ink:#2a2f3d;--ink-muted:#5d6170;--lily:#46568a;--shadow-soft:0 1px 2px rgba(42,47,61,.06),0 6px 20px rgba(42,47,61,.06);--font-serif:"Cormorant Garamond","Cormorant",Garamond,"Times New Roman",serif;--font-sans:Jost,"Futura","Avenir Next",system-ui,sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--ink);font-family:var(--font-sans);font-size:16px;line-height:1.55;overflow-wrap:anywhere}
main{max-width:420px;margin:0 auto;padding:72px 16px}
h1{font-family:var(--font-serif);font-weight:500;font-size:2.4rem;line-height:1.1;margin:0 0 16px}
p{margin:0 0 24px;color:var(--ink-muted)}
button{font:inherit;font-weight:500;background:var(--lily);color:#fff;border:0;border-radius:10px;padding:12px 24px;cursor:pointer;box-shadow:var(--shadow-soft)}
button:focus-visible{outline:2px solid var(--lily);outline-offset:2px}
`;

const page = (title: string, inner: string): string =>
  `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title>
<style>${CSS}</style></head><body><main>${inner}</main></body></html>`;

export const magicConfirmPage = (token: string): string =>
  page(
    'Sign in to Atelier',
    `<h1>Sign in to Atelier</h1><p>Confirm to finish signing in on the device that asked for this link.</p>
<form method="post" action="/auth/magic"><input type="hidden" name="token" value="${escapeHtml(token)}"><button type="submit">Sign in</button></form>`,
  );

export const magicDonePage = (): string =>
  page('Signed in', `<h1>You're signed in</h1><p>Return to Atelier.</p>`);

export const magicInvalidPage = (): string =>
  page('Link not valid', `<h1>This link isn't valid</h1><p>It may have expired or already been used. Request a new link from Atelier.</p>`);
