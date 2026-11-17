import { defineConfig } from 'vite';
// Extra hostnames the dev server should answer to (e.g. a private network name),
// comma-separated in SG_ALLOWED_HOSTS. Kept out of the repo on purpose.
const extraHosts = (process.env.SG_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
export default defineConfig({ base: './', server: { host: true, allowedHosts: extraHosts } });
