import { copyFileSync, cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

function copyManifestPlugin(): Plugin {
  let manifestPath = resolve(__dirname, "manifest.json");
  let localesDir = resolve(__dirname, "_locales");
  let outDir = resolve(__dirname, "dist");

  return {
    name: "copy-extension-manifest",
    configResolved(config) {
      manifestPath = resolve(config.root, "manifest.json");
      localesDir = resolve(config.root, "_locales");
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      copyFileSync(manifestPath, resolve(outDir, "manifest.json"));
      if (existsSync(localesDir)) {
        cpSync(localesDir, resolve(outDir, "_locales"), { recursive: true });
      }
    }
  };
}

export default defineConfig({
  plugins: [copyManifestPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "index.html"),
        contentScript: resolve(__dirname, "src/content/contentScript.ts")
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]"
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts"]
  }
});
