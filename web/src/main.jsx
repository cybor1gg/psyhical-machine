import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/mint.css";
import App from "./App.jsx";
import { initPerfMode } from "./space/perfMode";

// Decide the graphics tier before the first paint: cheap cabinet PCs get a
// lighter scene automatically (see space/perfMode.js).
initPerfMode();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
