import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import "./auth.css"
import "./features/native/clarity.css"
import "./features/native/wayfinding.css"
import { AuthBoundary } from "./components/auth-boundary"
import { TooltipProvider } from "@/components/ui/tooltip"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <AuthBoundary />
    </TooltipProvider>
  </StrictMode>
)
