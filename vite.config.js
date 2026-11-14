import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// host: true serves on the home network so the iPhone can open it for the swipe test.
export default defineConfig({
  base: "./", // relative paths so it works under a sub-folder (GitHub Pages)
  plugins: [react()],
  server: { host: true, port: 4198, strictPort: true },
});
