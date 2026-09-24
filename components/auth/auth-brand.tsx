import Image from "next/image";

export function AuthBrand() {
  return (
    <div className="auth-brand">
      <Image
        className="auth-brand__image"
        src="/media/rh-conect-logo.png"
        width={251}
        height={88}
        preload
        unoptimized
        alt="RH Conect — Pessoas que impulsionam resultados"
      />
    </div>
  );
}
