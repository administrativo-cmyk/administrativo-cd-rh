import Image from "next/image";

type AuthVisualPanelProps = { variant: "login" | "register" };

const references = {
  login: {
    src: "/media/auth-reference-login.png",
    width: 1929,
    height: 2001,
    alt: "Pessoas fazem grandes conquistas em um ambiente de trabalho colaborativo.",
  },
  register: {
    src: "/media/auth-reference-cadastro.png",
    width: 1599,
    height: 1659,
    alt: "Comece hoje a construir um melhor amanhã com uma gestão de pessoas integrada.",
  },
} as const;

export function AuthVisualPanel({ variant }: AuthVisualPanelProps) {
  const reference = references[variant];

  return (
    <aside className={`auth-visual auth-visual--${variant}`} aria-label="Visão institucional do RH Conect">
      <div className="auth-visual__reference-crop">
        <Image
          className="auth-visual__reference"
          src={reference.src}
          width={reference.width}
          height={reference.height}
          sizes="(max-width: 900px) 0px, 48vw"
          preload
          unoptimized
          alt={reference.alt}
        />
      </div>
    </aside>
  );
}
