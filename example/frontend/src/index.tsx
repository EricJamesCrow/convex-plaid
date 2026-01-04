import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import { QuickstartProvider } from "./Context";

// Initialize Convex client with your deployment URL
const convexUrl = process.env.REACT_APP_CONVEX_URL;

if (!convexUrl) {
  throw new Error(
    "Missing REACT_APP_CONVEX_URL environment variable. " +
    "Create a .env.local file with REACT_APP_CONVEX_URL=https://your-deployment.convex.cloud"
  );
}

const convex = new ConvexReactClient(convexUrl);

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement
);

root.render(
  <React.StrictMode>
    <ConvexProvider client={convex}>
      <QuickstartProvider>
        <App />
      </QuickstartProvider>
    </ConvexProvider>
  </React.StrictMode>
);
