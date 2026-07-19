import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/developers/",
  plugins: [react(), tailwindcss()],
  build: { sourcemap: false },
});
