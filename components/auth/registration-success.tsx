"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import { AuthBrand } from "@/components/auth/auth-brand";

export function RegistrationSuccess() {
  const [videoFailed, setVideoFailed] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);

  return (
    <div className="auth-success-page">
      <span className="auth-page__shape auth-page__shape--one" aria-hidden="true" />
      <span className="auth-page__shape auth-page__shape--two" aria-hidden="true" />
      <main className="auth-success-card">
        <div className="auth-success-card__brand"><AuthBrand /></div>

        <div className="auth-success-media" data-state={videoFailed ? "fallback" : videoEnded ? "ended" : "playing"}>
          {!videoFailed ? (
            <video
              data-testid="registration-success-video"
              src="/media/cadastro-realizado-rh.mp4"
              autoPlay
              muted
              playsInline
              controls={false}
              loop={false}
              preload="auto"
              onError={() => setVideoFailed(true)}
              onEnded={() => setVideoEnded(true)}
              aria-label="Animação de cadastro realizado"
            />
          ) : (
            <div className="auth-success-fallback" data-testid="registration-success-fallback">
              <span><Check aria-hidden="true" /></span>
              <small>Solicitação registrada</small>
            </div>
          )}
          <span className="auth-success-media__glow" aria-hidden="true" />
        </div>

        <section className="auth-success-copy">
          <span className="auth-success-copy__icon"><CheckCircle2 aria-hidden="true" /></span>
          <p className="auth-success-copy__eyebrow">Cadastro realizado com sucesso</p>
          <h1>Seu cadastro foi enviado para aprovação.</h1>
          <p>Você será informado assim que seu acesso for aprovado e liberado na plataforma.</p>

          <div className="auth-success-steps" aria-label="Próximas etapas">
            <span><Clock3 aria-hidden="true" /><span><strong>Status pendente</strong><small>Aguardando análise</small></span></span>
            <span><ShieldCheck aria-hidden="true" /><span><strong>Aprovação segura</strong><small>Perfil definido pela administração</small></span></span>
          </div>

          <Link className="auth-back-button" href="/login"><ArrowLeft aria-hidden="true" /> Voltar para o login</Link>
        </section>
      </main>
    </div>
  );
}
