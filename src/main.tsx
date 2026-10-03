import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("RadView3D app root is missing.");

createRoot(root).render(
  <React.StrictMode>
    <div className="dark app-root">
      <App />
    </div>
  </React.StrictMode>,
);
