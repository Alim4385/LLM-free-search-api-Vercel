export const metadata = { title: "Qaqa Search API", description: "Key-siz axtarış API-si LLM üçün" };
export default function RootLayout({ children }) {
  return (
    <html lang="az">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#0f1115", color: "#e6e6e6" }}>{children}</body>
    </html>
  );
}
