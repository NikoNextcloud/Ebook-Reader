const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_DIMENSION = 480;

const loadImage = (blob) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(blob);
  const image = new window.Image();
  image.onload = () => {
    URL.revokeObjectURL(url);
    resolve(image);
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    reject(new Error('Изображението не може да бъде прочетено.'));
  };
  image.src = url;
});

export const prepareCoverImage = async (file) => {
  if (!file) throw new Error('Избери изображение за корица.');
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error('Корица може да бъде JPEG, PNG или WebP изображение.');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('Изображението е твърде голямо. Максималният размер е 12 MB.');
  }

  const image = await loadImage(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = '#f2f0e8';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.76);
};
