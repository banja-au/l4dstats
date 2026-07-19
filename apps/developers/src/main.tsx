import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import { initializeDeveloperAnalytics } from "./analytics";

initializeDeveloperAnalytics();

createRoot(document.getElementById("root")!).render(<App />);
