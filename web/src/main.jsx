import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./styles/mint.css";
import App from "./App.jsx";
import { initFpsHud } from "./space/fpsHud";

// five taps in the top-left corner toggle the frame-rate readout — the way
// to judge rendering health standing at a cabinet, no dev tools
initFpsHud();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
