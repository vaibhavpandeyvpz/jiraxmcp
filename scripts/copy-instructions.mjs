import { cpSync, existsSync } from "node:fs";

if (existsSync("src/prompts")) {
  cpSync("src/prompts", "dist/prompts", { recursive: true });
}
