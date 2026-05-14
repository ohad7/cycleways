import React from "react";

function Tutorial({ onClose, open }) {
  if (!open) return null;

  return (
    <div
      className="react-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="react-tutorial-title"
    >
      <div className="react-modal__content react-modal__content--narrow">
        <header className="react-modal__header">
          <h2 id="react-tutorial-title">מדריך קצר</h2>
          <button
            className="react-modal__close"
            type="button"
            aria-label="סגירה"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <ol className="react-tutorial">
          <li>לחצו על נקודת התחלה ליד שביל CycleWays.</li>
          <li>הוסיפו נקודה נוספת כדי לחשב מסלול על הרשת.</li>
          <li>גררו נקודות כדי לעדכן את המסלול.</li>
          <li>פתחו את הסיכום כדי להוריד GPX או לשתף קישור.</li>
        </ol>
      </div>
    </div>
  );
}

export default Tutorial;
