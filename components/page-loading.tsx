import Image from "next/image";
import styles from "./page-loading.module.css";

export function PageLoading({ label = "Carregando sua próxima tela" }: { label?: string }) {
  return <div className={styles.page} aria-busy="true" aria-label="Carregando página">
    <div className={styles.topTrack} aria-hidden="true"><span className={styles.sweep} /></div>
    <div className={styles.content}>
      <Image src="/media/rh-conect-logo.png" alt="RH Conect" width={251} height={88} unoptimized className={styles.logo} />
      <div className={styles.scene} aria-hidden="true">
        <div className={styles.window}>
          <div className={styles.windowHeader}><span /><span /><span /></div>
          <div className={styles.windowBody}>
            <div className={styles.windowSidebar}><span /><span /><span /></div>
            <div className={styles.windowData}><div><span /><span /><span /></div><i /><i /><i /></div>
          </div>
          <div className={styles.scan} />
        </div>
        <span className={styles.badge}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" className={styles.message}>
        <p className={styles.title}>{label}</p>
        <p className={styles.description}>Só um instante. Estamos preparando tudo para você.</p>
      </div>
      <div className={styles.progressTrack} aria-hidden="true"><span className={styles.sweep} /></div>
      <p className={styles.caption}>Pessoas que impulsionam resultados.</p>
    </div>
    <div className={styles.preview} aria-hidden="true">
      <div className={styles.previewHeading} />
      <div className={styles.previewCards}>{[0, 1, 2].map(index => <div key={index}><span /><span /></div>)}</div>
      <div className={styles.previewRows}><span /><span /><span /></div>
    </div>
  </div>;
}
