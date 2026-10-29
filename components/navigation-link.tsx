"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";
import { createPortal } from "react-dom";
import styles from "./page-loading.module.css";

function NavigationProgress() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return createPortal(<div className={styles.navigationProgress} role="status" aria-label="Abrindo página">
    <span className={styles.sweep} aria-hidden="true" />
  </div>, document.body);
}

export default function NavigationLink({ children, ...props }: ComponentProps<typeof Link>) {
  return <Link {...props}>{children}<NavigationProgress /></Link>;
}
