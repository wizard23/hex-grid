import { resolve } from "node:path";
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  cacheDir: ".vite",
  plugins: [preact()],
  resolve: {
    alias: {
      "@asimov/shared": resolve(__dirname, "../shared/src")
    }
  },
  optimizeDeps: {
    exclude: ["@asimov/shared"]
  },
  server: {
    proxy: {
      // API_PORT moves the server and this proxy together (see README)
      "/v1": `http://localhost:${process.env.API_PORT ?? "3939"}`
    },
    fs: {
      allow: [resolve(__dirname, "..")]
    },
    port: 8989
  }
});
