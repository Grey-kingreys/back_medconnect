/**
 * Constantes du module de stockage (Cloudflare R2).
 *
 * Source de vérité SERVEUR : whitelists MIME, tailles max et TTL des URLs
 * présignées ne sont jamais négociables par le client.
 */

/** Jeton d'injection du `S3Client` R2 (instancié une seule fois, cf. StorageModule). */
export const R2_CLIENT = Symbol('R2_CLIENT');

/** Visibilité d'un fichier = bucket cible + politique (MIME / taille). */
export type StorageVisibility = 'public' | 'private';

// ─── TTL des URLs présignées (secondes) ───────────────────────
export const PRESIGNED_UPLOAD_TTL = 600; // 10 min pour téléverser
export const PRESIGNED_READ_TTL = 300; // 5 min pour lire un document privé

// ─── Tailles maximales (octets) ───────────────────────────────
export const MAX_PUBLIC_IMAGE_SIZE = 5 * 1024 * 1024; // 5 Mo
export const MAX_MEDICAL_DOC_SIZE = 20 * 1024 * 1024; // 20 Mo

// ─── Whitelists MIME ──────────────────────────────────────────
/** Images publiques (avatars, logos, images d'articles). */
export const PUBLIC_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Documents médicaux (ordonnances, analyses, imagerie / DICOM). */
export const MEDICAL_DOC_MIME = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/dicom',
] as const;

/**
 * Politique par visibilité : quels MIME sont acceptés et quelle taille max.
 * `public`  → bucket public, images légères.
 * `private` → bucket privé, documents médicaux plus lourds.
 */
export const STORAGE_POLICY: Record<
  StorageVisibility,
  { mimes: readonly string[]; maxSize: number }
> = {
  public: { mimes: PUBLIC_IMAGE_MIME, maxSize: MAX_PUBLIC_IMAGE_SIZE },
  private: { mimes: MEDICAL_DOC_MIME, maxSize: MAX_MEDICAL_DOC_SIZE },
};

/**
 * Extension de fichier dérivée du type MIME (jamais du nom original : évite
 * path traversal, collisions et fuite d'info sur le patient).
 */
export const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/dicom': 'dcm',
};
