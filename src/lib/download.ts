// Hands a file to the browser to save: text or bytes, with a file name.

/**
 * Saves `content` as `filename`. The object URL is revoked a little later rather than at once: some browsers
 * start the download only after click() returns, and revoking first cancels it. The link is attached to the
 * page while clicked, which Firefox needs.
 */
export function downloadFile(filename: string, content: string | Uint8Array | Blob, type = 'application/octet-stream'): void {
  // A Blob (e.g. a File from the browser's file storage) is handed over as it is, not copied into memory.
  const url = URL.createObjectURL(content instanceof Blob ? content : new Blob([content as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
