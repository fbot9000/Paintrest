export function NotYetPage({ title, slice }: { title: string; slice: string }) {
  return (
    <main className="page">
      <h1>{title}</h1>
      <div className="empty">
        <p className="muted">Denne flaten kommer i {slice} av planen. Datamodellen er klar for den.</p>
      </div>
    </main>
  );
}
