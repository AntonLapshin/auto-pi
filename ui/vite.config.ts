import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The UI talks to the local backend on port 8787. In dev, proxy /api to it so
// the React app can fetch relative /api/* URLs (no CORS needed).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
