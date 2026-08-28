import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet, Link, useNavigate } from 'react-router-dom';
import QuizPage from './pages/QuizPage';
import CreationQuiz from './pages/CreationQuiz';
import MesQuiz from './pages/MesQuiz';
import PartageQuiz from './pages/PartageQuiz';
import RelectureQuiz from './pages/RelectureQuiz';
import QuizResults from './components/QuizResults';
import Apprenants from './components/Apprenants';
import AdminGate from './components/AdminGate';
import AppBar from './components/AppBar';
import Icon from './components/Icon';
import { getAdminPassword } from './api';
import { chemins } from './chemins';
import './App.css';

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
 */
function EspaceFormateur() {
  const [unlocked, setUnlocked] = useState(!!getAdminPassword());

  return (
    <div className="app">
      {/* AppBar acceptait déjà une prop `action` que personne ne passait :
          c'était la prise prévue. Un SEUL lien, et seulement une fois
          déverrouillé — à 375 px, la marque et « Mes quiz » tiennent, en
          ajouter un second déborderait. */}
      <AppBar
        action={
          unlocked ? (
            <Link className="app-bar-link" to={chemins.mesQuiz}>
              <Icon name="list" size={15} width={1.7} />
              Mes quiz
            </Link>
          ) : null
        }
      />
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
 * retour contextuel étant devenu le bouton Précédent du navigateur.
 */
function EcranApprenants() {
  const navigate = useNavigate();
  return <Apprenants onBack={() => navigate(chemins.creation)} />;
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
          <Route index element={<CreationQuiz />} />
          <Route path="quiz" element={<MesQuiz />} />
          <Route path="quiz/:id" element={<PartageQuiz />} />
          <Route path="quiz/:id/questions" element={<RelectureQuiz />} />
          <Route path="quiz/:id/resultats" element={<QuizResults />} />
          <Route path="apprenants" element={<EcranApprenants />} />
          <Route path="*" element={<Navigate to={chemins.creation} replace />} />
        </Route>

        {/* `replace` et non une navigation ordinaire : sans lui, le bouton
            Précédent ramènerait sur « / », qui redirigerait de nouveau — le
            formateur resterait prisonnier de sa propre barre de navigation. */}
        <Route path="*" element={<Navigate to={chemins.creation} replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
