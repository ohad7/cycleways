import React from "react";

function TopBar({
  onOpenTutorial,
  mobileMenuOpen,
  onMobileMenuToggle,
}) {
  return (
    <header className="header">
      <div className="logo-section">
        <h1 className="site-title">מפת שבילי אופניים - גליל עליון וגולן</h1>
      </div>
      <button
        className="mobile-menu-btn"
        type="button"
        aria-label="פתיחת תפריט"
        onClick={onMobileMenuToggle}
      >
        <ion-icon name="menu-outline" />
      </button>
      <nav
        className={`nav-links${mobileMenuOpen ? " active" : ""}`}
        id="nav-links"
      >
        <a className="nav-link" href="#trails">
          שבילים
        </a>
        <a className="nav-link" href="#reccomendations">
          המלצות
        </a>
        <a className="nav-link" href="#contact">
          צרו קשר
        </a>
        <button
          className="nav-link help-tutorial-btn"
          type="button"
          onClick={onOpenTutorial}
        >
          מדריך
        </button>
      </nav>
    </header>
  );
}

export default TopBar;
