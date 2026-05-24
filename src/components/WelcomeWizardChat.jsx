import React from "react";
import RouteCard from "./RouteCard.jsx";
import { catalogFilter } from "./catalogFilter.js";

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
      <div className="ww-chat__scroll">
        {conversation.map((msg) =>
          msg.kind === "bot" ? (
            <div key={msg.key} className="ww-bubble ww-bubble--bot">{msg.text}</div>
          ) : (
            <div key={msg.key} className="ww-bubble ww-bubble--user">{msg.text}</div>
          ),
        )}

        {activeQuestion && (
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
