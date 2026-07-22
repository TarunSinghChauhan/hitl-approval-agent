import "./globals.css";

export const metadata = {
  title: "HITL Approval Agent",
  description: "An autonomous agent that knows when to pause and ask a human.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
