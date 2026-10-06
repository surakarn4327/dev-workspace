// The fixed HTML shell of an exported result page: markup and CSS only, no words the user reads (those arrive
// as `title` and `body`, already escaped). Kept apart so the "no hard-coded words" scan can skip this boilerplate.

const STYLE = 'body{font-family:system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;line-height:1.6}pre{white-space:pre-wrap;word-wrap:break-word;font:inherit}';

/** `title` is the plain job title (escaped here for the head); `heading` and `body` are escaped HTML. */
export function htmlPage(lang: string, title: string, heading: string, body: string): string {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return [
    '<!doctype html>',
    `<html lang="${lang}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${esc(title)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    `<h1>${heading}</h1>`,
    body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
