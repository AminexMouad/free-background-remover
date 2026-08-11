// Thin wrapper around @imgly/background-removal so the rest of the app
// only depends on a small, typed surface.
import { removeBackground, type Config } from '@imgly/background-removal'

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024 // 25 MB

export interface RemovalProgress {
  key: string
  current: number
  total: number
}

export function isAcceptedImageType(file: File): boolean {
  return (ACCEPTED_TYPES as readonly string[]).includes(file.type)
}

export function validateImageFile(file: File): string | null {
  if (!isAcceptedImageType(file)) {
    return 'Unsupported file type. Please use a PNG, JPG, or WebP image.'
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return 'Image is too large. Please use a file under 25 MB.'
  }
  return null
}

/**
 * Runs background removal entirely in the browser (WASM/ONNX). Nothing is
 * uploaded anywhere. Resolves to a PNG blob with a real alpha channel.
 */
export async function removeImageBackground(
  file: File,
  onProgress?: (progress: RemovalProgress) => void,
): Promise<Blob> {
  const config: Config = {
    output: { format: 'image/png', quality: 1 },
    progress: (key, current, total) => {
      onProgress?.({ key, current, total })
    },
  }
  return removeBackground(file, config)
}
