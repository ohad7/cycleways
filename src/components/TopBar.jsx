import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";

function TopBar({
  onOpenTutorial,
  mobileMenuOpen,
  onMobileMenuToggle,
  navLinks,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const isRoutesSection =
    location.pathname.startsWith("/routes") ||
    location.pathname.startsWith("/featured");

  const handleTutorialClick = () => {
    if (location.pathname === "/" && onOpenTutorial) {
      onOpenTutorial();
    } else {
      navigate("/");
    }
  };

  const closeMobileMenu = () => {
    if (mobileMenuOpen) onMobileMenuToggle?.();
  };

  const handleAnchorClick = (event, href) => {
    const samePageHash = href.startsWith("#");
    if (!samePageHash) {
      closeMobileMenu();
      return;
    }
    if (!navLinks && location.pathname !== "/") {
      event.preventDefault();
      navigate({ pathname: "/", hash: href });
      closeMobileMenu();
      return;
    }

    const target = document.getElementById(href.slice(1));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    navigate(
      {
        pathname: location.pathname,
        search: location.search,
        hash: href,
      },
      { replace: true, preventScrollReset: true },
    );
    closeMobileMenu();
  };

  const navLinkClass = (item) => {
    const active = (() => {
      if (item.section === "routes") return isRoutesSection;
      if (item.section === "map") {
        return location.pathname === "/" && !location.hash;
      }
      if (item.href && item.href.startsWith("#")) {
        return location.pathname === "/" && location.hash === item.href;
      }
      if (item.to === "/routes/" || item.to === "/routes") return isRoutesSection;
      if (item.to === "/") return location.pathname === "/" && !location.hash;
      return false;
    })();
    return `nav-link${active ? " nav-link--active" : ""}`;
  };

  const defaultNavLinks = [
    { label: "מפה", to: "/", section: "map" },
    { label: "מסלולים", to: "/routes/", section: "routes" },
    { label: "על המפה", href: "#trails" },
    { label: "צרו קשר", href: "#contact" },
  ];
  const renderedNavLinks = navLinks || defaultNavLinks;
  const showTutorialButton = Boolean(onOpenTutorial) && !isRoutesSection;

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
        {renderedNavLinks.map((item) =>
          item.href ? (
            <a
              key={item.href}
              className={navLinkClass(item)}
              href={
                item.href.startsWith("#") && !navLinks
                  ? `/${item.href}`
                  : item.href
              }
              onClick={(e) => handleAnchorClick(e, item.href)}
            >
              {item.label}
            </a>
          ) : (
            <Link
              key={item.to}
              className={navLinkClass(item)}
              to={item.to}
              onClick={closeMobileMenu}
            >
              {item.label}
            </Link>
          ),
        )}
        {showTutorialButton && (
          <button
            className="nav-link help-tutorial-btn"
            type="button"
            onClick={() => {
              handleTutorialClick();
              closeMobileMenu();
            }}
          >
            מדריך
          </button>
        )}
      </nav>
    </header>
  );
}

export default TopBar;
