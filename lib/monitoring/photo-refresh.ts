"use client";

let revision = 0;
const listeners = new Set<() => void>();
export const photoRevision = () => revision;
export const serverPhotoRevision = () => 0;
export function subscribePhotoRefresh(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Reload protected images after explicit refresh or a successful identity change. */
export function refreshEmployeePhotos() {
  revision += 1;
  listeners.forEach((listener) => listener());
}
