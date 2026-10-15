/** Every route change re-mounts this, so each page eases in instead of popping. */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="kb-page-in">{children}</div>;
}
