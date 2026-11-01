import { createRoot } from "react-dom/client";
import { Dashboard } from "../../src/components/Dashboard";
import { Header } from "../../src/components/Header";
import { PrivacyContent } from "../../src/components/PrivacyContent";

const root = createRoot(document.getElementById("root")!);
root.render(location.pathname === "/privacy" ? <><Header /><PrivacyContent /></> : <Dashboard />);
