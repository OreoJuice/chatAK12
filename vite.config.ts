import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const server = `http://localhost:${env.SERVER_PORT ?? 3001}`;

  return {
    root: "web",
    plugins: [react()],
    build: { outDir: "../dist", emptyOutDir: true },
    server: {
      proxy: { "/api": server, "/sprites": server, "/backgrounds": server, "/thumbs": server, "/voices": server },
    },
  };
});
