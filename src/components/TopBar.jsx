import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";

function TopBar({
  onOpenTutorial,
  mobileMenuOpen,
  onMobileMenuToggle,
  onOpenWizard,
  navLinks,
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

  const handleAnchorClick = (event, href) => {
    const target = document.querySelector(href);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", href);
    if (mobileMenuOpen) onMobileMenuToggle?.();
  };

  return (
    <header className="header">
      <div className="logo-section">
        <Link to="/" reloadDocument className="site-title-link">
          <h1 className="site-title">מפת שבילי אופניים - גליל עליון וגולן</h1>
        </Link>
      </div>
      <button
        className="mobile-menu-btn"
        type="button"
        aria-label="פתיחת תפריט"
        onClick={onMobileMenuToggle}
      >
        <Icon name="menu-outline" />
      </button>
      <nav
        className={`nav-links${mobileMenuOpen ? " active" : ""}`}
        id="nav-links"
      >
        {navLinks ? (
          navLinks.map((item) =>
            item.href ? (
              <a
                key={item.href}
                className="nav-link"
                href={item.href}
                onClick={(e) => handleAnchorClick(e, item.href)}
              >
                {item.label}
              </a>
            ) : (
              <Link
                key={item.to}
                className="nav-link"
                to={item.to}
                reloadDocument
              >
                {item.label}
              </Link>
            ),
          )
        ) : (
          <>
            <a
              className="nav-link"
              href="/#trails"
              onClick={(e) => handleAnchorClick(e, "#trails")}
            >
              שבילים
            </a>
            <a
              className="nav-link"
              href="/#reccomendations"
              onClick={(e) => handleAnchorClick(e, "#reccomendations")}
            >
              המלצות
            </a>
            <Link className="nav-link" to="/routes">
              מסלולים
            </Link>
            <a
              className="nav-link"
              href="/#contact"
              onClick={(e) => handleAnchorClick(e, "#contact")}
            >
              צרו קשר
            </a>
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
          </>
        )}
      </nav>
    </header>
  );
}

export default TopBar;
