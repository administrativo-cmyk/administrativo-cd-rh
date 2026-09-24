"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";

export function RegistrationSuccess() {
  const router = useRouter();
  const [videoFailed, setVideoFailed] = useState(false);

  return (
    <div className="auth-success-page">
      <main className="auth-success-minimal">
        <div className="auth-success-media">
          {!videoFailed ? (
            <video
              data-testid="registration-success-video"
              src="/media/cadastro-realizado-rh.mp4"
              autoPlay
              loop
              muted
              playsInline
              controls={false}
              preload="auto"
              onError={() => setVideoFailed(true)}
              aria-label="Animação de cadastro realizado"
            />
          ) : (
            <div className="auth-success-fallback" data-testid="registration-success-fallback" aria-label="Cadastro realizado com sucesso">
              <Check aria-hidden="true" />
            </div>
          )}
        </div>
        <button className="auth-back-button" type="button" onClick={() => router.push("/login")}>
          <ArrowLeft aria-hidden="true" /> Voltar para o login
        </button>
      </main>
    </div>
  );
}
