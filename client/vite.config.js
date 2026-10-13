import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Every variable whose name starts with VITE_ is copied into the JavaScript that every visitor downloads, so it is
// PUBLIC. Only the API address belongs there (VITE_API_URL). This check stops the build if a VITE_ variable looks like
// a secret (for example someone sets VITE_DATABASE_URL or VITE_OWNER_PASSWORD on the hosting dashboard).
const LOOKS_SECRET = /SECRET|PASSWORD|PASSWD|TOKEN|PRIVATE|CREDENTIAL|API_?KEY|DATABASE|OWNER_|SESSION|COOKIE/i;
const LOOKS_LIKE_URL_WITH_LOGIN = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]*:[^/\s]*@/i;

function refusePublicSecrets(mode) {
  const fromFiles = loadEnv(mode, process.cwd(), 'VITE_');
  const all = { ...fromFiles, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('VITE_'))) };
  for (const [name, value] of Object.entries(all)) {
    if (LOOKS_SECRET.test(name) || /^postgres(ql)?:\/\//i.test(value) || LOOKS_LIKE_URL_WITH_LOGIN.test(value)) {
      throw new Error(
        `Refusing to build: ${name} would be published inside the public JavaScript bundle, and it looks like a secret. ` +
          'Remove it. Secrets (DATABASE_URL, OWNER_PASSWORD, ...) belong only on the backend server.',
      );
    }
  }
}

export default defineConfig(({ mode }) => {
  refusePublicSecrets(mode);
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        '/api': 'http://localhost:3001',
      },
    },
  };
});
