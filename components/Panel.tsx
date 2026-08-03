import styles from './Panel.module.css'

export default function Panel({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className={styles.panel}>
      <h1 className={styles.title}>{title}</h1>
      {children}
    </div>
  )
}
