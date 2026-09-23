import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import App from "./App";
import { capturePlayerInvitationLink } from "./pages/landing/player-invitation-link";

capturePlayerInvitationLink(window);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
