import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

void import("./features/schematic-preview/mojang-resources")
  .then(({ preloadBundledMinecraftArchive }) => preloadBundledMinecraftArchive())
  .catch(() => undefined);

const root = document.getElementById("root");

if (!root) {
  throw new Error("找不到应用挂载点");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
