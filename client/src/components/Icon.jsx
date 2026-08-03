/**
 * Jeu d'icônes Kemet Quiz — traits 1.6px, grille 24px.
 * Règle : la flèche circulaire est RÉSERVÉE à « régénérer / refaire ».
 * Le partage utilise la flèche d'envoi.
 */
const PATHS = {
  doc: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h4" />
    </>
  ),
  check: <path d="M5 13l4 4L19 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  arrowRight: (
    <>
      <path d="M5 12h13" />
      <path d="M12 6l6 6-6 6" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="M19 12H6" />
      <path d="M12 6l-6 6 6 6" />
    </>
  ),
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5H6a2 2 0 0 0-2 2v9" />
    </>
  ),
  send: (
    <>
      <path d="M20.5 3.5L11 13" />
      <path d="M20.5 3.5l-6 17-3.5-7.5L3.5 9.5z" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 5v6h-6" />
    </>
  ),
  list: (
    <>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h10" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h0" />
    </>
  ),
  edit: <path d="M4 20h4l10-10-4-4L4 16z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </>
  ),
  chart: (
    <>
      <path d="M5 20V10" />
      <path d="M12 20V5" />
      <path d="M19 20v-7" />
    </>
  ),
};

function Icon({ name, size = 20, stroke = 'currentColor', width = 1.6, className = '' }) {
  const paths = PATHS[name];
  if (!paths) return null;
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths}
    </svg>
  );
}

export default Icon;
