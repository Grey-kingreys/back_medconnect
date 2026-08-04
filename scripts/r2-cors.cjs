/**
 * Configure la politique CORS des buckets Cloudflare R2 pour autoriser l'upload
 * direct (PUT présigné) depuis le navigateur. Sans ça, le PUT cross-origin est
 * bloqué par le navigateur (« Erreur réseau ») — curl n'est pas concerné.
 *
 * Exige un token R2 de niveau ADMIN : le token de l'application est limité aux objets
 * et se heurte à AccessDenied sur la config d'un bucket. Sans token admin, passer par
 * le tableau de bord Cloudflare (R2 > bucket > Settings > CORS Policy).
 *
 * Usage (dans le conteneur backend, qui a @aws-sdk/client-s3) :
 *   docker compose exec -T backend node scripts/r2-cors.cjs
 * Origines autorisées : CORS_ORIGINS (CSV) ou http://localhost:3000 par défaut.
 * Remplace la politique en bloc : lister toutes les origines d'un coup.
 * En prod : CORS_ORIGINS=http://localhost:3000,https://medconnecte.com
 */
const {
  S3Client,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
} = require('@aws-sdk/client-s3');

const accountId = process.env.R2_ACCOUNT_ID;
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const buckets = [process.env.R2_BUCKET_PUBLIC, process.env.R2_BUCKET_PRIVATE].filter(Boolean);
const origins = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const CORSConfiguration = {
  CORSRules: [
    {
      AllowedOrigins: origins,
      AllowedMethods: ['GET', 'PUT', 'HEAD'],
      AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3600,
    },
  ],
};

(async () => {
  console.log('Origines autorisées :', origins.join(', '));
  for (const Bucket of buckets) {
    try {
      const before = await client
        .send(new GetBucketCorsCommand({ Bucket }))
        .catch(() => null);
      console.log(`[${Bucket}] CORS avant :`, before ? JSON.stringify(before.CORSRules) : 'aucun');
      await client.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration }));
      const after = await client.send(new GetBucketCorsCommand({ Bucket }));
      console.log(`[${Bucket}] CORS après :`, JSON.stringify(after.CORSRules));
    } catch (e) {
      console.error(`[${Bucket}] échec :`, e.message);
    }
  }
})();
