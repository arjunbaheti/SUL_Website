export type Row = { title: string; body: string; href?: string };

// The numbered "index" rows from the original About and Partners pages.
export function IndexRows({ rows }: { rows: Row[] }) {
  return (
    <div className="index">
      {rows.map((r, i) => {
        const inner = (
          <>
            <div className="index-top">
              <span className="index-num">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="index-title">{r.title}</h3>
              {r.href ? <span className="index-arrow" aria-hidden="true">→</span> : null}
            </div>
            <div className="index-body"><div><p>{r.body}</p></div></div>
          </>
        );
        return r.href ? (
          <a className="index-row reveal" href={r.href} key={r.title}>{inner}</a>
        ) : (
          <div className="index-row reveal" key={r.title}>{inner}</div>
        );
      })}
    </div>
  );
}
