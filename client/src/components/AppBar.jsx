import { NavLink } from 'react-router-dom';

/**
 * Barre d'application : la marque à gauche, et selon l'appelant soit un accès
 * unique (`action`), soit une rangée d'onglets persistants (`tabs`).
 *
 * QuizPage (l'écran de passation, public) monte `<AppBar />` sans rien
 * d'autre : aucune rangée d'onglets ne s'affiche jamais là où elle n'a pas de
 * sens. Seul App.jsx, pour l'espace formateur, passe `tabs`.
 *
 * `tabs` est un tableau `{ to, label, end? }`. NavLink pose lui-même
 * `aria-current="page"` sur l'onglet actif : rien à faire ici pour tenir ce
 * contrat. `end` n'est nécessaire que pour l'onglet du tableau de bord
 * (`/formateur`), sans quoi NavLink le marquerait actif sur CHAQUE sous-route
 * (mes quiz, apprenants, officines…), qui commencent toutes par ce préfixe.
 *
 * Sous 720 px, la rangée défile horizontalement (.app-tabs, App.css) plutôt
 * que de faire disparaître un onglet : les quatre restent ATTEIGNABLES sur
 * mobile.
 */
function AppBar({ action, tabs }) {
  return (
    <header className="app-bar-shell">
      <div className="app-bar">
        <a className="app-brand" href="/">
          <img src="/kemet-logo.png" alt="Kemet Services" className="app-mark-img" />
          <span className="app-brand-name">Kemet Quiz</span>
        </a>
        {action}
      </div>
      {tabs && tabs.length > 0 && (
        <nav className="app-tabs" aria-label="Espace formateur">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => `app-tab${isActive ? ' is-active' : ''}`}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}

export default AppBar;
