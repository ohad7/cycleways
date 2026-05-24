import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

function TopBar({
  onOpenTutorial,
  mobileMenuOpen,
  onMobileMenuToggle,
  onOpenWizard,
}) {
  const navigate = useNavigate();
  const location = useLocation();

  const handleTutorialClick = () => {
    if (location.pathname === "/" && onOpenTutorial) {
      onOpenTutorial();
    } else {
      navigate("/");
    }
  };

  return (
    <header className="header">
      <div className="logo-section">
        <Link to="/" className="site-title-link">
          <h1 className="site-title">מפת שבילי אופניים - גליל עליון וגולן</h1>
        </Link>
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
        <Link className="nav-link" to="/#trails">
          שבילים
        </Link>
        <Link className="nav-link" to="/#reccomendations">
          המלצות
        </Link>
        <Link className="nav-link" to="/#contact">
          צרו קשר
        </Link>
        {onOpenWizard && (
          <button
            className="nav-link topbar-find-button"
            type="button"
            onClick={onOpenWizard}
          >
            מצא מסלול
          </button>
        )}
        <button
          className="nav-link help-tutorial-btn"
          type="button"
          onClick={handleTutorialClick}
        >
          מדריך
        </button>
      </nav>
    </header>
  );
}

export default TopBar;
