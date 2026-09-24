import type { ReactNode } from "react";
import { AuthBrand } from "@/components/auth/auth-brand";
import { AuthVisualPanel } from "@/components/auth/auth-visual-panel";

type AuthLayoutProps = {
  children: ReactNode;
  variant: "login" | "register";
};

export function AuthLayout({ children, variant }: AuthLayoutProps) {
  return (
    <div className={`auth-page auth-page--${variant}`}>
      <span className="auth-page__shape auth-page__shape--one" aria-hidden="true" />
      <span className="auth-page__shape auth-page__shape--two" aria-hidden="true" />
      <main className={`auth-shell auth-shell--${variant}`}>
        <section className="auth-form-panel">
          <AuthBrand />
          <div className="auth-form-panel__content">{children}</div>
        </section>
        <AuthVisualPanel variant={variant} />
      </main>
    </div>
  );
}
