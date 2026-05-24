import React, { useState } from "react";
import RouteCard from "./RouteCard.jsx";
import { catalogFilter } from "./catalogFilter.js";

const PLACE_QUICK_PICK_COUNT = 4;

const QUESTIONS = [
  {
    key: "place",
    intro: "היי 👋 בואו נמצא לכם מסלול",
    prompt: "מאיפה תרצו להתחיל?",
    optionsFromPlaces: true,
  },
  {
    key: "region",
    prompt: "באיזה אזור?",
    optionsFromZones: true,
  },
  {
    key: "distance",
    prompt: 'כמה ק"מ?',
    options: [
      { value: "short",  label: 'קצר (< 10)' },
      { value: "medium", label: 'בינוני (10–25)' },
      { value: "long",   label: 'ארוך (> 25)' },
      { value: "any",    label: "לא משנה" },
    ],
  },
  {
    key: "difficulty",
    prompt: "רמת קושי?",
    options: [
      { value: "easy",     label: "קל" },
      { value: "moderate", label: "בינוני" },
      { value: "hard",     label: "מאתגר" },
      { value: "any",      label: "לא משנה" },
    ],
  },
  {
    key: "style",
    prompt: "איזה סגנון?",
    options: [
      { value: "family",      label: "משפחתי" },
      { value: "scenic",      label: "נוף" },
      { value: "sporty",      label: "ספורטיבי" },
      { value: "adventurous", label: "הרפתקני" },
      { value: "any",         label: "לא משנה" },
    ],
  },
];

const STEP_KEYS = QUESTIONS.map((q) => q.key);
const BOT_AVATAR = "🚴";

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

function BotTurn({ messages }) {
  return (
    <div className="ww-turn ww-turn--bot">
      <div className="ww-turn__avatar" aria-hidden="true">{BOT_AVATAR}</div>
      <div className="ww-turn__bubbles">
        {messages.map((m, i) => (
          <div key={i} className="ww-bubble ww-bubble--bot">{m.text}</div>
        ))}
      </div>
    </div>
  );
}

function UserTurn({ messages }) {
  return (
    <div className="ww-turn ww-turn--user">
      <div className="ww-turn__bubbles">
        {messages.map((m, i) => (
          <div key={i} className="ww-chip ww-chip--user-reply">{m.text}</div>
        ))}
      </div>
    </div>
  );
}

function PlaceQuickReplies({ places, onPick }) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");

  if (!searching) {
    const picks = places.slice(0, PLACE_QUICK_PICK_COUNT);
    return (
      <div className="ww-replies">
        {picks.map((p) => (
          <button
            key={p.id}
            type="button"
            className="ww-chip ww-chip--reply"
            onClick={() => onPick(p.id)}
          >
            {p.name}
          </button>
        ))}
        <button
          type="button"
          className="ww-chip ww-chip--reply ww-chip--secondary"
          onClick={() => setSearching(true)}
        >
          🔍 חפש מקום אחר
        </button>
        <button
          type="button"
          className="ww-chip ww-chip--reply ww-chip--ghost"
          onClick={() => onPick("any")}
        >
          לא משנה
        </button>
      </div>
    );
  }

  const q = query.trim();
  const matches = q.length > 0
    ? places.filter((p) => p.name.includes(q) || p.id.includes(q.toLowerCase()))
    : places;

  return (
    <div className="ww-replies ww-replies--search">
      <div className="ww-search-row">
        <input
          type="search"
          className="ww-search-input"
          placeholder="הקלידו שם מקום…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <button
          type="button"
          className="ww-search-close"
          aria-label="סגור חיפוש"
          onClick={() => { setSearching(false); setQuery(""); }}
        >
          ✕
        </button>
      </div>
      <div className="ww-replies">
        {matches.length === 0 && (
          <span className="ww-place-empty">לא נמצא מקום מתאים</span>
        )}
        {matches.slice(0, 20).map((p) => (
          <button
            key={p.id}
            type="button"
            className="ww-chip ww-chip--reply"
            onClick={() => onPick(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function GenericQuickReplies({ options, onPick }) {
  return (
    <div className="ww-replies">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`ww-chip ww-chip--reply${opt.value === "any" ? " ww-chip--ghost" : ""}`}
          onClick={() => onPick(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function renderOptions(question, zones) {
  if (question.optionsFromZones) {
    const opts = (zones || []).map((z) => ({ value: z.id, label: z.name }));
    opts.push({ value: "any", label: "לא משנה" });
    return opts;
  }
  return question.options;
}

function labelForAnswer(question, value, places, zones) {
  if (value === "any") return "לא משנה";
  if (question.optionsFromPlaces) {
    return places.find((p) => p.id === value)?.name || value;
  }
  if (question.optionsFromZones) {
    return (zones || []).find((z) => z.id === value)?.name || value;
  }
  return question.options?.find((o) => o.value === value)?.label || value;
}

function buildConversationTurns(state, places, zones) {
  // A turn is a contiguous run of messages from one side. Build the full
  // turn-by-turn transcript from the answered + active step.
  const turns = [];
  const pushBot = (text) => {
    const last = turns[turns.length - 1];
    if (last && last.kind === "bot") last.messages.push({ text });
    else turns.push({ kind: "bot", messages: [{ text }] });
  };
  const pushUser = (text) => {
    turns.push({ kind: "user", messages: [{ text }] });
  };

  const { step, answers } = state;
  STEP_KEYS.forEach((key, idx) => {
    if (idx > step) return;
    if (idx === step && answers[key] == null) {
      // Active turn — emit bot question only.
      const q = QUESTIONS[idx];
      if (q.intro) pushBot(q.intro);
      pushBot(q.prompt);
      return;
    }
    if (answers[key] == null) return; // skipped (region)
    const q = QUESTIONS[idx];
    if (q.intro) pushBot(q.intro);
    pushBot(q.prompt);
    pushUser(labelForAnswer(q, answers[key], places, zones));
  });
  return turns;
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
  const atResults = step >= STEP_KEYS.length;
  const activeQuestion = !atResults ? QUESTIONS[step] : null;

  const turns = buildConversationTurns(state, places, zones);
  let results = null;
  if (atResults) results = catalogFilter(catalog?.entries || [], answers);

  const handlePick = (value) => {
    if (!activeQuestion) return;
    dispatch({ type: "ANSWER", key: activeQuestion.key, value });
  };

  return (
    <div className="ww-chat">
      <WizardProgress step={step} />
      <div className="ww-chat__scroll">
        {turns.map((turn, idx) =>
          turn.kind === "bot" ? (
            <BotTurn key={idx} messages={turn.messages} />
          ) : (
            <UserTurn key={idx} messages={turn.messages} />
          ),
        )}

        {activeQuestion && activeQuestion.key === "place" && (
          <PlaceQuickReplies places={places} onPick={handlePick} />
        )}

        {activeQuestion && activeQuestion.key !== "place" && (
          <GenericQuickReplies
            options={renderOptions(activeQuestion, zones)}
            onPick={handlePick}
          />
        )}

        {atResults && (
          <>
            <BotTurn
              messages={[
                {
                  text:
                    results.length > 0
                      ? `מצאתי ${results.length} מסלולים שמתאימים לכם:`
                      : "לא נמצאו מסלולים מתאימים. אפשר לנסות לשנות תנאי.",
                },
              ]}
            />
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
