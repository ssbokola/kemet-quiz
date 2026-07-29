function AppBar({ action }) {
  return (
    <header className="app-bar">
      <a className="app-brand" href="/">
        <img src="/kemet-logo.png" alt="Kemet Services" className="app-mark-img" />
        <span className="app-brand-name">Kemet Quiz</span>
      </a>
      {action}
    </header>
  );
}

export default AppBar;
