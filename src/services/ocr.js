// OCR за сканирани PDF-и (без текстов слой). Tesseract се зарежда лениво,
// а езиковите данни се теглят от CDN при първо ползване (нужен е интернет).
export const ocrPdf = async (arrayBuffer, onProgress) => {
  const pdfjsLib = await import('pdfjs-dist');
  const workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['bul', 'eng']);

  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = Math.min(pdf.numPages, 50); // безопасен таван
    let text = '';

    for (let i = 1; i <= pages; i += 1) {
      onProgress?.(Math.round(((i - 1) / pages) * 100));
      const page = await pdf.getPage(i); // eslint-disable-line no-await-in-loop
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise; // eslint-disable-line no-await-in-loop
      const { data } = await worker.recognize(canvas); // eslint-disable-line no-await-in-loop
      text += `${data.text}\n\n`;
    }

    onProgress?.(100);
    return text.trim();
  } finally {
    await worker.terminate();
  }
};

export const ocrImages = async (images, onProgress) => {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker(['bul', 'eng']);
  const texts = [];

  try {
    for (let index = 0; index < images.length; index += 1) {
      onProgress?.(Math.round((index / Math.max(1, images.length)) * 100));
      const { data } = await worker.recognize(images[index]);
      texts.push(data.text || '');
    }
    onProgress?.(100);
    return texts;
  } finally {
    await worker.terminate();
  }
};
