export const slugifyFilename = (value: string, fallback: string) => {
  const base = (value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return base || fallback;
};

export const triggerDownload = (content: string, filename: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const buildWordHtmlDocument = (title: string, content: string) => {
  const paragraphs = content
    .split(/\n{2,}/)
    .map(block => `<p>${escapeHtml(block)}</p>`)
    .join('\n');

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: Georgia, "Times New Roman", serif; margin: 2.5cm; color: #222; line-height: 1.65; }
      h1, h2, h3 { font-family: Georgia, "Times New Roman", serif; color: #111; }
      h1 { font-size: 24pt; margin-bottom: 18pt; }
      h2 { font-size: 16pt; margin-top: 22pt; margin-bottom: 8pt; }
      h3 { font-size: 13pt; margin-top: 16pt; margin-bottom: 6pt; }
      p { margin: 0 0 10pt 0; white-space: pre-wrap; }
      hr { border: 0; border-top: 1px solid #d6d3d1; margin: 18pt 0; }
      .meta { color: #666; font-size: 10pt; }
    </style>
  </head>
  <body>
    ${paragraphs}
  </body>
</html>`;
};
