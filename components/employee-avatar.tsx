"use client";

import Image from "next/image";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [photoAspectRatio, setPhotoAspectRatio] = useState(1);
  const measurePhoto = (image: HTMLImageElement) => {
    if (image.naturalWidth && image.naturalHeight) setPhotoAspectRatio(image.naturalWidth / image.naturalHeight);
  };
  useEffect(() => {
    if (!previewOpen) return;
    // Handle Escape before an enclosing drawer's document listener.
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setPreviewOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [previewOpen]);
  useEffect(() => {
    if (!src || failedSource !== src) return;
    const retryOnFocus = () => setRetry((value) => value + 1);
    window.addEventListener("focus", retryOnFocus, { once: true });
    return () => window.removeEventListener("focus", retryOnFocus);
  }, [failedSource, src]);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const avatarClassName = cn("relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-slate-900 text-xs font-semibold text-white", className);
  if (!src || failedSource === src) return <span className={avatarClassName} style={{ width: size, height: size }}>
    <span role="img" aria-label={`${name} — foto indisponível`} title="Foto pendente">{initials}</span>
  </span>;

  return <DialogPrimitive.Root open={previewOpen} onOpenChange={setPreviewOpen}>
    <DialogPrimitive.Trigger asChild>
      <button type="button" aria-label={`Ampliar foto de ${name}`} title="Ampliar foto" onClick={event => event.stopPropagation()} className={cn(avatarClassName, "cursor-zoom-in focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600")} style={{ width: size, height: size }}>
        <Image key={src} src={src} alt={`Foto de ${name}`} width={size} height={size} unoptimized className="h-full w-full object-cover" onLoad={event => measurePhoto(event.currentTarget)} onError={() => { setFailedSource(src); setPreviewOpen(false); }} />
      </button>
    </DialogPrimitive.Trigger>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay onClick={event => { event.stopPropagation(); setPreviewOpen(false); }} className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md" />
      <DialogPrimitive.Content aria-describedby={undefined} onClick={event => event.stopPropagation()} className="fixed left-1/2 top-1/2 z-[101] w-fit max-w-[70vw] -translate-x-1/2 -translate-y-1/2 rounded-lg shadow-2xl outline-none">
        <DialogPrimitive.Title className="sr-only">Foto de {name}</DialogPrimitive.Title>
        <Image src={src} alt={`Foto ampliada de ${name}`} width={1200} height={1200} unoptimized className="block h-auto max-h-[70dvh] max-w-[70vw] rounded-lg object-contain" style={{ width: `min(70vw, ${70 * photoAspectRatio}dvh)` }} onLoad={event => measurePhoto(event.currentTarget)} onError={() => { setFailedSource(src); setPreviewOpen(false); }} />
        <DialogPrimitive.Close aria-label="Fechar foto ampliada" className="absolute right-2 top-2 grid size-8 cursor-pointer place-items-center rounded-full bg-slate-950/80 text-white hover:bg-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white after:absolute after:-inset-1.5">
          <X size={16} aria-hidden="true" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
