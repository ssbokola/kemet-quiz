import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

import { adminFetchOuReseau, messageErreur } from '../api';
import { useFocusAuMontage } from '../ecran';

const LETTERS = ['A', 'B', 'C', 'D'];

function stripLetter(text) {
  return String(text).replace(/^[A-D]\)\s*/, '');
}

/**
 * Relecture / édition des questions générées, avant partage.
 * Le formateur peut reformuler une question, corriger une option,
 * changer la bonne réponse, ou régénérer une question isolée.
 */
function ReviewQuestions({
  quizId,
  title,
  questions,
  dropped = 0,
  brouillonRepris = false,
  nonEnregistre = false,
  onBrouillon,
  onPublish,
  publishing,
  publishError,
}) {
  const [items, setItems] = useState(questions);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);
  // Le message porte un numéro d'occurrence : deux refus IDENTIQUES à la suite
  // écriraient sinon la même chaîne, React court-circuiterait le rendu, le DOM
  // ne muterait pas — et la région d'alerte resterait muette au second appui.
  // Même motif que dans AdminGate et UploadPDF.
  const [rowError, setRowError] = useState({ texte: '', n: 0 });
  const signalerRowError = (texte) => setRowError((prec) => ({ texte, n: prec.n + 1 }));
  // Copies retardées d'un commit des deux erreurs de l'écran : ce sont ELLES
  // qui sont rendues dans les régions d'alerte, jamais les valeurs d'origine.
  // Voir les effets plus bas.
  const [announcedRowError, setAnnouncedRowError] = useState({ texte: '', n: 0 });
  const [announcedPublishError, setAnnouncedPublishError] = useState('');
  const headingRef = useRef(null);

  // Convention de l'application : chaque écran reprend le focus sur son propre
  // titre principal à son montage. L'écran précédent (progression de la
  // génération, ou partage) est démonté avec l'élément qui avait le focus :
  // sans cette reprise, le focus retombe sur <body> et la tabulation repart du
  // haut du document.
  //
  // ⚠️ La prémisse d'origine — « AdminPage démarre toujours à l'étape upload,
  // cet écran n'est donc jamais le tout premier monté » — EST TOMBÉE avec les
  // vraies adresses : /formateur/quiz/:id/questions se recharge au F5. D'où la
  // garde partagée, qui ne prend le focus que sur un changement d'écran.
  useFocusAuMontage(headingRef);

  // Les corrections tapées à la main ne partent au serveur qu'au clic sur
  // « Publier ». On les remonte à chaque changement pour que l'écran parent
  // puisse les mettre de côté : sans cela un rafraîchissement les perdrait EN
  // SILENCE, sur un écran visuellement identique.
  useEffect(() => {
    onBrouillon?.(items);
  }, [items, onBrouillon]);

  // Aucun message n'est jamais rendu dans le commit qui monte sa région : il est
  // recopié ici, au commit suivant. Une région live qui naît AVEC son texte
  // n'est pas annoncée de façon fiable ; celles de cet écran naissent donc vides
  // puis se remplissent, y compris au remontage de l'écran avec une erreur déjà
  // présente (retour depuis l'écran de partage par « Modifier »).
  useEffect(() => {
    setAnnouncedRowError(rowError);
  }, [rowError]);

  useEffect(() => {
    setAnnouncedPublishError(publishError);
  }, [publishError]);

  const update = (idx, patch) =>
    setItems((prev) => prev.map((q, i) => (i === idx ? { ...q, ...patch } : q)));

  const setOption = (idx, optIdx, value) =>
    setItems((prev) =>
      prev.map((q, i) =>
        i === idx
          ? { ...q, options: q.options.map((o, j) => (j === optIdx ? `${LETTERS[j]}) ${value}` : o)) }
          : q
      )
    );

  const regenerate = async (idx) => {
    // Les boutons de régénération ne sont plus désactivés (voir plus bas) :
    // c'est ce garde d'entrée qui empêche deux régénérations simultanées. Le
    // refus est MOTIVÉ et non silencieux — le bouton cliqué peut être celui
    // d'une autre question que celle en cours, l'utilisateur doit savoir
    // pourquoi rien ne se passe. Le message part dans la région d'alerte.
    if (busy !== null) {
      signalerRowError(
        'Une régénération est déjà en cours. Attendez qu’elle se termine, puis réessayez.'
      );
      return;
    }
    setBusy(idx);
    signalerRowError('');
    try {
      // Une requête qui n'aboutit pas du tout (API arrêtée, réseau coupé) n'a ni
      // statut ni corps à traduire : `adminFetchOuReseau` lui donne son propre
      // message en français, au lieu du « Failed to fetch » du navigateur.
      const res = await adminFetchOuReseau(`/api/quiz/${quizId}/regenerate/${idx}`, {
        method: 'POST',
      });
      // Le contrôle du statut vient AVANT toute lecture du corps. L'ordre
      // inverse faisait échouer l'analyse JSON sur les réponses qui n'en sont
      // pas — page d'erreur d'une passerelle, corps vide d'un 500 — et le
      // « Unexpected token… » de l'analyseur remplaçait alors le vrai message,
      // y compris sur une erreur métier parfaitement explicite.
      if (!res.ok) {
        throw new Error(await messageErreur(res, 'La question n’a pas pu être régénérée.'));
      }
      // Sur le chemin nominal le corps est attendu, mais rien ne garantit qu'il
      // soit lisible : un corps illisible ou sans question est un échec énoncé,
      // pas une exception d'analyse ni une mise à jour avec `undefined`.
      const data = await res.json().catch(() => null);
      if (!data || !data.question) {
        throw new Error(
          'Le serveur a renvoyé une réponse inattendue, la question n’a pas pu être régénérée.'
        );
      }
      update(idx, data.question);
    } catch (err) {
      // Repli : rien ne garantit qu'un rejet porte une Error, et sans message la
      // région resterait muette.
      signalerRowError(err?.message || 'La question n’a pas pu être régénérée.');
    } finally {
      setBusy(null);
    }
  };

  // Même règle que pour la régénération : le bouton reste actif, la double
  // publication est bloquée ici.
  const publish = () => {
    if (publishing) return;
    onPublish(items);
  };

  return (
    <div>
      <div className="review-head">
        {/* Titre de premier niveau : c'est le titre le plus haut du document
            dans cet état de l'application. */}
        <h1 ref={headingRef} tabIndex={-1}>
          Relire avant de partager
        </h1>
        <span className="subtle">
          {items.length} questions générées pour « {title} » — modifiez ce qui doit l’être.
        </span>
      </div>

      {dropped > 0 && (
        <p className="notice" style={{ marginBottom: 'var(--s-5)' }}>
          <Icon name="info" size={15} width={1.8} />
          <span>
            {dropped} question{dropped > 1 ? 's' : ''} écartée{dropped > 1 ? 's' : ''} à la
            génération (réponse manquante ou options incomplètes). Utilisez la régénération si vous
            en voulez davantage.
          </span>
        </p>
      )}

      {/* Le quiz est DÉJÀ en ligne : ce qui n'est pas enregistré, ce sont les
          corrections tapées à la main. Le dire est le prix des adresses — sur
          l'ancienne machine à états, un F5 renvoyait à l'écran de création et
          la perte se voyait ; ici l'écran revient à l'identique. */}
      {nonEnregistre && (
        <p className="notice" style={{ marginBottom: 'var(--s-5)' }}>
          <Icon name="info" size={15} width={1.8} />
          <span>
            {brouillonRepris
              ? 'Vos corrections précédentes ont été retrouvées, mais elles ne sont pas encore enregistrées.'
              : 'Vos modifications ne sont pas encore enregistrées.'}{' '}
            Cliquez sur <b>Publier le quiz</b> pour que les apprenants les voient.
          </span>
        </p>
      )}

      {/* Conteneur monté EN PERMANENCE, près du titre : c'est lui qui porte
          role="alert", pas le message. Une région ajoutée au DOM en même temps
          que son texte n'est pas annoncée — d'où `announcedRowError`, retardé
          d'un commit. La marge est portée par le conteneur et non par le
          message : à vide, `.error-slot:empty` le sort du flux, marge comprise,
          et aucune gouttière n'est consommée.
          Garder la forme ternaire : `{announcedRowError && …}` avec une chaîne
          vide peut laisser un nœud texte vide et casser :empty.
          Le message n'est PAS focalisable : il est annoncé par la région et par
          elle seule, et le bouton cliqué a gardé le focus (il n'est plus
          désactivé pendant la requête). */}
      <div className="error-slot" role="alert" aria-atomic="true" style={{ marginBottom: 'var(--s-5)' }}>
        {announcedRowError.texte ? (
          <p className="error-msg" key={announcedRowError.n}>
            <Icon name="info" size={16} width={1.8} />
            <span>{announcedRowError.texte}</span>
          </p>
        ) : null}
      </div>

      <div className="stack--tight" style={{ display: 'flex', flexDirection: 'column' }}>
        {items.map((q, idx) => {
          const isEditing = editing === idx;
          return (
            <div className="q-card" key={idx}>
              <div className="q-card-bar">
                <span className="q-card-num">QUESTION {idx + 1}</span>
                <div className="q-card-tools">
                  <button
                    type="button"
                    className="tool-btn"
                    onClick={() => setEditing(isEditing ? null : idx)}
                  >
                    <Icon name={isEditing ? 'check' : 'edit'} size={12} width={1.8} />
                    {isEditing ? 'Terminé' : 'Modifier'}
                  </button>
                  {/* Même raison que le bouton « Publier » plus bas : jamais
                      désactivé. Le bouton cliqué gardait autrement le focus
                      moins d'une seconde avant que `disabled` ne le lui
                      retire, laissant l'échec sans annonce ET sans commande
                      focalisée. Le cumul est refusé par le garde d'entrée de
                      `regenerate`, avec un message dans la région d'alerte. */}
                  <button
                    type="button"
                    className="tool-btn"
                    onClick={() => regenerate(idx)}
                    aria-busy={busy === idx}
                    aria-label="Régénérer cette question"
                    title="Régénérer cette question"
                  >
                    {busy === idx ? (
                      <span
                        className="spinner spinner--sm"
                        style={{ width: 13, height: 13 }}
                        aria-hidden="true"
                      />
                    ) : (
                      <Icon name="refresh" size={13} width={1.8} />
                    )}
                  </button>
                </div>
              </div>

              {isEditing ? (
                <textarea
                  className="q-card-input"
                  value={q.question}
                  onChange={(e) => update(idx, { question: e.target.value })}
                />
              ) : (
                <p className="q-card-text">{q.question}</p>
              )}

              <div className="q-options">
                {q.options.map((option, optIdx) => {
                  const letter = LETTERS[optIdx];
                  const isAnswer = q.answer === letter;
                  const pastille = (
                    <span className="q-option-dot">
                      {isAnswer && <Icon name="check" size={13} width={2.6} />}
                    </span>
                  );

                  // En édition, la ligne porte DEUX commandes : choisir la bonne
                  // réponse et corriger son texte. Elles doivent être frères.
                  // Le modèle de contenu de <button> interdit tout descendant
                  // interactif : le champ imbriqué qui existait ici n'était, selon
                  // le moteur, ni atteignable au Tab ni focalisable au clic — d'où
                  // le stopPropagation qui tentait de rattraper le pointeur. Le
                  // nom accessible du bouton, calculé depuis son contenu, aspirait
                  // en prime la valeur du champ.
                  if (isEditing) {
                    return (
                      <div
                        key={optIdx}
                        className={`q-option q-option--edit ${isAnswer ? 'is-answer' : ''}`}
                      >
                        <button
                          type="button"
                          className="q-option-pick"
                          onClick={() => update(idx, { answer: letter })}
                          aria-pressed={isAnswer}
                          aria-label={`Définir l’option ${letter} comme bonne réponse`}
                          title="Définir comme bonne réponse"
                        >
                          {pastille}
                        </button>
                        <input
                          className="q-option-input"
                          value={stripLetter(option)}
                          onChange={(e) => setOption(idx, optIdx, e.target.value)}
                          aria-label={`Texte de l’option ${letter}`}
                        />
                      </div>
                    );
                  }

                  return (
                    <button
                      key={optIdx}
                      type="button"
                      className={`q-option ${isAnswer ? 'is-answer' : ''}`}
                      onClick={() => update(idx, { answer: letter })}
                      aria-pressed={isAnswer}
                      title="Définir comme bonne réponse"
                    >
                      {pastille}
                      <span>{stripLetter(option)}</span>
                    </button>
                  );
                })}
              </div>

              {q.explanation && !isEditing && (
                <div className="r-explain">
                  <Icon name="info" size={15} width={1.8} />
                  <span>{q.explanation}</span>
                </div>
              )}
              {q.explanation && isEditing && (
                <textarea
                  className="q-card-input"
                  style={{ minHeight: 60 }}
                  value={q.explanation}
                  onChange={(e) => update(idx, { explanation: e.target.value })}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Seconde région d'alerte permanente, juste au-dessus du bouton
          « Publier » : l'échec de publication est ainsi annoncé, et il est
          visible à l'endroit même où l'utilisateur se trouve — le bouton garde
          le focus pendant toute la requête. Mêmes règles que la région
          ci-dessus : texte retardé d'un commit, forme ternaire, marge sur le
          conteneur. */}
      <div className="error-slot" role="alert" aria-atomic="true" style={{ marginTop: 'var(--s-6)' }}>
        {announcedPublishError ? (
          <p className="error-msg">
            <Icon name="info" size={16} width={1.8} />
            <span>{announcedPublishError}</span>
          </p>
        ) : null}
      </div>

      <div className="sticky-actions">
        {/* Bouton volontairement TOUJOURS actif. `disabled` pendant la requête
            faisait perdre le focus : c'est ce bouton qui l'a au moment du clic,
            le navigateur le blure en le désactivant et le focus retombe sur
            <body> — à l'échec le message arrivait donc sans qu'aucune commande
            ne soit atteignable pour réessayer. La double publication est
            bloquée par le garde d'entrée de `publish`, et l'attente est exposée
            par aria-busy plutôt que par une indisponibilité. */}
        <button
          type="button"
          className="btn btn--ink btn--block"
          onClick={publish}
          aria-busy={publishing}
        >
          {publishing ? (
            <>
              <span className="btn-spinner" aria-hidden="true" /> Enregistrement…
            </>
          ) : (
            <>
              Publier le quiz
              <Icon name="arrowRight" size={18} width={1.8} />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default ReviewQuestions;
