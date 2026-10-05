import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  // The router plugin writes routeTree.gen.ts from routes/ and splits each route into its own chunk.
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true, routesDirectory: "routes", generatedRouteTree: "routeTree.gen.ts" }),
    react(),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  // Portless passes the address to serve on in HOST and PORT.
  server: { host: process.env.HOST ?? "localhost", port: Number(process.env.PORT) || 3000, strictPort: true },
});
