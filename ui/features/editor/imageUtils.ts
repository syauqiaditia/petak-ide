export const IMAGE_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico',
];

export function isImageFile(path?: string | null): boolean {
  if (!path) return false;
  const lower = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function getImageFormat(path: string): string {
  const ext = path.split('.').pop()?.toUpperCase() || '';
  if (ext === 'JPG') return 'JPEG';
  return ext;
}

export function getImageMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'bmp':
      return 'image/bmp';
    case 'ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function calculateZoom(
  currentZoom: number,
  action: 'in' | 'out' | 'reset'
): number {
  switch (action) {
    case 'in':
      return Math.min(Number((currentZoom * 1.25).toFixed(2)), 10);
    case 'out':
      return Math.max(Number((currentZoom / 1.25).toFixed(2)), 0.1);
    case 'reset':
      return 1;
  }
}
