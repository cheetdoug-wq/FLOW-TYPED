import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { PrivacyContent } from "@/components/PrivacyContent";

export const metadata: Metadata = { title: "Privacy | Flow Typed" };

export default function PrivacyPage() {
  return (
    <>
      <Header />
      <PrivacyContent />
    </>
  );
}
