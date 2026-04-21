import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "sam's zo",
  description: "Personal command center for a Zo Computer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: "#000", color: "#fff" }}>
        {children}
      </body>
    </html>
  );
}
