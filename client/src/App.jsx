import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, useNavigate } from 'react-router-dom';
import QuizPage from './pages/QuizPage';
import Dashboard from './pages/Dashboard';
import CreationQuiz from './pages/CreationQuiz';
import MesQuiz from './pages/MesQuiz';
import PartageQuiz from './pages/PartageQuiz';
import RelectureQuiz from './pages/RelectureQuiz';
import OfficinesEspace from './pages/OfficinesEspace';
import QuizResults from './components/QuizResults';
import Apprenants from './components/Apprenants';
import AdminGate from './components/AdminGate';
import AppBar from './components/AppBar';
import { getAdminPassword } from './api';
import { chemins } from './chemins';
import './App.css';

/**
 * Les quatre onglets persistants de l'espace formateur, dans l'ordre voulu.
 * `end` n'est posé QUE sur le tableau de bord : sans lui, NavLink le
 * marquerait actif sur chaque sous-route formateur, qui commencent toutes
 * par ce même préfixe « /formateur ».
 */
const ONGLETS_FORMATEUR = [
  { to: chemins.tableauDeBord, label: 'Tableau de bord', end: true },
  { to: chemins.nouveau, label: 'Nouveau quiz' },
  { to: chemins.mesQuiz, label: 'Mes quiz' },
  { to: chemins.officines, label: 'Officines' },
];

/**
 * Mise en page de l'espace formateur, et sa PORTE.
 *
 * AdminGate vit ici, dans l'élément de la route parente : une seule porte pour
 * toutes les routes /formateur, y compris celles qu'on ajoutera. Un visiteur
 * non authentifié qui ouvre /formateur/quiz/<id>/resultats voit le formulaire
 * de mot de passe et RIEN d'autre — aucun titre, aucun nom, aucune date : tout
 * ce qui s'affiche vient de routes protégées par requireAdmin.
 *
 * Gain de fond du passage aux routes : `unlocked` vit désormais dans une mise
 * en page qui ne se remonte pas quand on change d'écran.
 *
 * La barre à onglets REMPLACE l'ancien lien unique « Mes quiz » (autrefois
 * seul accès secondaire de l'AppBar) : les quatre onglets couvrent désormais
 * ce rôle, et un second accès dirait deux fois la même chose. Comme lui, elle
 * n'apparaît qu'une fois déverrouillé — avant, elle exposerait la structure de
 * l'espace formateur à qui n'a pas encore prouvé le mot de passe.
 */
function EspaceFormateur() {
  const [unlocked, setUnlocked] = useState(!!getAdminPassword());

  return (
    <div className="app">
      <AppBar tabs={unlocked ? ONGLETS_FORMATEUR : null} />
      <main className="app-main app-main--wide">
        {unlocked ? <Outlet /> : <AdminGate onUnlock={() => setUnlocked(true)} />}
      </main>
    </div>
  );
}

/**
 * Apprenants garde son aiguillage interne à quatre vues : son en-tête
 * documente longuement pourquoi chaque vue doit être un TYPE de composant
 * distinct (c'est ce qui fait rejouer l'effet de focus), et le besoin qui a
 * ouvert ce chantier porte sur les quiz — on ne met pas en favori la fiche d'un
 * apprenant. Seul le retour change : il vise désormais une adresse STABLE, le
 * retour contextuel étant devenu le bouton Précédent du navigateur. Cette
 * adresse est le tableau de bord — l'ancien index de l'espace formateur, et
 * toujours le point d'entrée naturel une fois qu'on quitte l'annuaire.
 */
function EcranApprenants() {
  const navigate = useNavigate();
  return <Apprenants onBack={() => navigate(chemins.tableauDeBord)} />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* ⛔ /quiz/:id est l'adresse PUBLIQUE de l'apprenant. Elle est imprimée
            dans des QR codes déjà scannés et partie dans des messages WhatsApp :
            elle est gelée à vie. Elle reste à la racine, hors de /formateur, et
            n'est JAMAIS imbriquée sous la mise en page formateur — l'apprenant
            recevrait le mur de mot de passe. */}
        <Route path="/quiz/:id" element={<QuizPage />} />

        <Route path="/formateur" element={<EspaceFormateur />}>
          {/* L'index est désormais le tableau de bord, pas la création : c'est
              lui que voit le formateur en arrivant, et la création a migré sur
              sa propre adresse (/formateur/nouveau) juste en dessous. */}
          <Route index element={<Dashboard />} />
          <Route path="nouveau" element={<CreationQuiz />} />
          <Route path="quiz" element={<MesQuiz />} />
          <Route path="quiz/:id" element={<PartageQuiz />} />
          <Route path="quiz/:id/questions" element={<RelectureQuiz />} />
          <Route path="quiz/:id/resultats" element={<QuizResults />} />
          <Route path="apprenants" element={<EcranApprenants />} />
          <Route path="officines" element={<OfficinesEspace />} />
          <Route path="*" element={<Navigate to={chemins.tableauDeBord} replace />} />
        </Route>

        {/* `replace` et non une navigation ordinaire : sans lui, le bouton
            Précédent ramènerait sur « / », qui redirigerait de nouveau — le
            formateur resterait prisonnier de sa propre barre de navigation. */}
        <Route path="*" element={<Navigate to={chemins.tableauDeBord} replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
