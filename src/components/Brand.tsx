export function Brand() {
  return (
    <a className="brand" href="#top" aria-label="Litematica Material Studio 首页">
      <svg className="brand__mark" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M24 3 43 14v20L24 45 5 34V14L24 3Z" fill="currentColor" opacity=".16" />
        <path d="m24 7 15 9-15 9-15-9 15-9Z" fill="currentColor" opacity=".9" />
        <path d="M9 19.8 22 27.5v13.8L9 33.6V19.8Z" fill="currentColor" opacity=".48" />
        <path d="m39 19.8-13 7.7v13.8l13-7.7V19.8Z" fill="currentColor" opacity=".7" />
        <path d="m20 13 4-2.4 4 2.4-4 2.4-4-2.4Z" fill="#06110d" />
      </svg>
      <span>
        <strong>Litematica</strong>
        <small>Material Studio</small>
      </span>
    </a>
  );
}
