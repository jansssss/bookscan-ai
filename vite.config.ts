import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, readdir, writeFile } from "node:fs/promises";
export default defineConfig({
  base: process.env.BASE_PATH || "./",
  plugins: [
    react(),
    {
      name: "offline-shell",
      async closeBundle() {
        const files = await readdir("dist/assets");
        const sw = await readFile("dist/sw.js", "utf8");
        const version = files.filter((n) => n.endsWith(".js")).join("-");
        await writeFile(
          "dist/sw.js",
          sw
            .replace("bookscan-v1", "bookscan-" + version)
            .replace(
              "/* BUILD_ASSETS */",
              files.map((n) => JSON.stringify("./assets/" + n)).join(","),
            ),
        );
      },
    },
  ],
  worker: { format: "es" },
});
