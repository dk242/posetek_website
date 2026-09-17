import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import CoachesPage from "./pages/coaches/CoachesPage";

createRoot(document.getElementById("root")!).render(<StrictMode><CoachesPage /></StrictMode>);
