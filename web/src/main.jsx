import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/mint.css";
import { initQuality } from "./space/perf";
import App from "./App.jsx";

// Decide the graphics tier before the first paint: cheap cabinet PCs get a
// lighter scene automatically (see space/perf.js).
initQuality();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
