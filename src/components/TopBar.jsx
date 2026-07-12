import React, { useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Icon from "./Icon.jsx";

function TopBar({
  mobileMenuOpen,
  onMobileMenuToggle,
  navLinks,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const menuButtonRef = useRef(null);
  const isRoutesSection =
    location.pathname.startsWith("/routes") ||
    location.pathname.startsWith("/featured");

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

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onMobileMenuToggle?.();
      menuButtonRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen, onMobileMenuToggle]);

  return (
    <header className="header">
      <div className="logo-section">
        <Link to="/" reloadDocument className="site-title-link">
          <div className="site-title">מפת שבילי אופניים - גליל עליון וגולן</div>
        </Link>
      </div>
      <button
        className="mobile-menu-btn"
        ref={menuButtonRef}
        type="button"
        aria-label={mobileMenuOpen ? "סגירת תפריט" : "פתיחת תפריט"}
        aria-expanded={mobileMenuOpen}
        aria-controls="nav-links"
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
              aria-current={navLinkClass(item).includes("nav-link--active") ? "page" : undefined}
            >
              {item.label}
            </a>
          ) : (
            <Link
              key={item.to}
              className={navLinkClass(item)}
              to={item.to}
              onClick={closeMobileMenu}
              aria-current={navLinkClass(item).includes("nav-link--active") ? "page" : undefined}
            >
              {item.label}
            </Link>
          ),
        )}
      </nav>
    </header>
  );
}

export default TopBar;
