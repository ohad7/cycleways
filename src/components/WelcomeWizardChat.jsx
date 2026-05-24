import React, { useState } from "react";
import RouteCard from "./RouteCard.jsx";
import { catalogFilter } from "./catalogFilter.js";

const PLACE_QUICK_PICK_COUNT = 4;

function PlacePicker({ places, onPick }) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const q = query.trim();
  const matches = q.length > 0
    ? places.filter((p) => p.name.includes(q) || p.id.includes(q.toLowerCase()))
    : showAll
      ? places
      : places.slice(0, PLACE_QUICK_PICK_COUNT);
  return (
    <div className="ww-place-picker">
      <input
        type="search"
        className="ww-place-search"
        placeholder="חפש מקום…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="ww-options">
        {matches.map((p) => (
          <button
            key={p.id}
            type="button"
            className="ww-option-btn"
            onClick={() => onPick(p.id)}
          >
            {p.name}
          </button>
        ))}
        {matches.length === 0 && (
          <span className="ww-place-empty">לא נמצא מקום מתאים</span>
        )}
      </div>
      <div className="ww-place-actions">
        {q.length === 0 && !showAll && places.length > PLACE_QUICK_PICK_COUNT && (
          <button
            type="button"
            className="ww-place-link"
            onClick={() => setShowAll(true)}
          >
            ראו את כולם ({places.length})
          </button>
        )}
        <button
          type="button"
          className="ww-option-btn"
          onClick={() => onPick("any")}
        >
          לא משנה
        </button>
      </div>
    </div>
  );
}

const QUESTIONS = [
  { key: "place",      prompt: "מאיפה תרצו להתחיל?", optionsFromPlaces: true },
  { key: "region",     prompt: "באיזה אזור?",         optionsFromZones: true },
  { key: "distance",   prompt: 'כמה ק"מ?',            options: [
    { value: "short",  label: 'קצר (< 10 ק"מ)' },
    { value: "medium", label: 'בינוני (10–25 ק"מ)' },
    { value: "long",   label: 'ארוך (> 25 ק"מ)' },
    { value: "any",    label: "לא משנה" },
  ]},
  { key: "difficulty", prompt: "רמת קושי?",          options: [
    { value: "easy",     label: "קל" },
    { value: "moderate", label: "בינוני" },
    { value: "hard",     label: "מאתגר" },
    { value: "any",      label: "לא משנה" },
  ]},
  { key: "style",      prompt: "איזה סגנון?",         options: [
    { value: "family",      label: "משפחתי" },
    { value: "scenic",      label: "נוף" },
    { value: "sporty",      label: "ספורטיבי" },
    { value: "adventurous", label: "הרפתקני" },
    { value: "any",         label: "לא משנה" },
  ]},
];

const STEP_KEYS = QUESTIONS.map((q) => q.key);

function WizardProgress({ step }) {
  const total = QUESTIONS.length;
  const answered = Math.min(step, total);
  return (
    <div className="ww-progress">
      <span>{answered} / {total}</span>
      <span className="ww-progress__dots">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`ww-progress__dot${i < answered ? " filled" : ""}`}
          />
        ))}
      </span>
    </div>
  );
}

function renderOptions(question, places, zones) {
  if (question.optionsFromPlaces) {
    const opts = (places || []).map((p) => ({ value: p.id, label: p.name }));
    opts.push({ value: "any", label: "לא משנה" });
    return opts;
  }
  if (question.optionsFromZones) {
    const opts = (zones || []).map((z) => ({ value: z.id, label: z.name }));
    opts.push({ value: "any", label: "לא משנה" });
    return opts;
  }
  return question.options;
}

export default function WelcomeWizardChat({
  state,
  dispatch,
  catalog,
  places,
  zones,
  onSelectRoute,
}) {
  const { step, answers } = state;
  const conversation = [];

  STEP_KEYS.forEach((key, idx) => {
    if (idx >= step) return;
    if (answers[key] == null) return;
    const q = QUESTIONS[idx];
    const opts = renderOptions(q, places, zones);
    const chosenLabel = opts.find((o) => o.value === answers[key])?.label || answers[key];
    conversation.push({ kind: "bot",  text: q.prompt, key: `${key}-q` });
    conversation.push({ kind: "user", text: chosenLabel, key: `${key}-a` });
  });

  const atResults = step >= STEP_KEYS.length;
  let activeQuestion = null;
  if (!atResults) {
    activeQuestion = QUESTIONS[step];
    conversation.push({ kind: "bot", text: activeQuestion.prompt, key: `${activeQuestion.key}-q-active` });
  }

  let results = null;
  if (atResults) {
    results = catalogFilter(catalog?.entries || [], answers);
  }

  return (
    <div className="ww-chat">
      <WizardProgress step={step} />
      <div className="ww-chat__scroll">
        {conversation.map((msg) =>
          msg.kind === "bot" ? (
            <div key={msg.key} className="ww-bubble ww-bubble--bot">{msg.text}</div>
          ) : (
            <div key={msg.key} className="ww-bubble ww-bubble--user">{msg.text}</div>
          ),
        )}

        {activeQuestion && activeQuestion.key === "place" && (
          <PlacePicker
            places={places}
            onPick={(value) => dispatch({ type: "ANSWER", key: "place", value })}
          />
        )}

        {activeQuestion && activeQuestion.key !== "place" && (
          <div className="ww-options">
            {renderOptions(activeQuestion, places, zones).map((opt) => (
              <button
                key={opt.value}
                type="button"
                className="ww-option-btn"
                onClick={() => dispatch({ type: "ANSWER", key: activeQuestion.key, value: opt.value })}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {atResults && (
          <>
            <h2 className="ww-results-title">
              {results.length > 0
                ? `${results.length} מסלולים מתאימים`
                : "לא נמצאו מסלולים מתאימים. נסו לשנות תנאי."}
            </h2>
            {results.map((entry) => (
              <RouteCard
                key={entry.slug}
                entry={entry}
                places={places}
                onSelect={onSelectRoute}
              />
            ))}
            <div className="ww-results-actions">
              <button type="button" onClick={() => dispatch({ type: "RESET" })}>
                התחל מחדש
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
