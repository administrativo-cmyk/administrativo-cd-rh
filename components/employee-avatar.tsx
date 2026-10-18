"use client";

import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { photoRevision, serverPhotoRevision, subscribePhotoRefresh } from "@/lib/monitoring/photo-refresh";

export function EmployeeAvatar({ name, employeeId, ownProfile = false, identity, size = 36, className }: {
  name: string; employeeId?: string; ownProfile?: boolean; identity?: { sourceId: string; value: string }; size?: number; className?: string;
}) {
  const revision = useSyncExternalStore(subscribePhotoRefresh, photoRevision, serverPhotoRevision);
  const [retry, setRetry] = useState(0);
  const base = identity ? `/api/monitoring/identity-photo?sourceId=${encodeURIComponent(identity.sourceId)}&identityValue=${encodeURIComponent(identity.value)}` : employeeId ? `/api/monitoring/photo?employeeId=${encodeURIComponent(employeeId)}` : ownProfile ? "/api/monitoring/photo" : null;
  const src = base ? `${base}${base.includes("?") ? "&" : "?"}revision=${revision}-${retry}` : null;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  useEffect(() => {
    if (!src || failedSource !== src) return;
    const retryOnFocus = () => setRetry((value) => value + 1);
    window.addEventListener("focus", retryOnFocus, { once: true });
    return () => window.removeEventListener("focus", retryOnFocus);
  }, [failedSource, src]);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return <span className={cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-slate-900 text-xs font-semibold text-white", className)} style={{ width: size, height: size }}>
    {src && failedSource !== src ? <Image key={src} src={src} alt={`Foto de ${name}`} width={size} height={size} unoptimized className="h-full w-full object-cover" onError={() => setFailedSource(src)} /> : <span role="img" aria-label={`${name} — foto indisponível`} title="Foto pendente">{initials}</span>}
  </span>;
}
