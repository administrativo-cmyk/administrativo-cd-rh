import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chamada Diária | Administrativo CD",
  description: "Controle operacional de presença e banco de horas do Administrativo CD.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
