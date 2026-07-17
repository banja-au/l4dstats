import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: process.env.WITCHWATCH_API_URL ?? "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/health": {
        target: process.env.WITCHWATCH_API_URL ?? "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
