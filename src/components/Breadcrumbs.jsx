import React from "react";
import { Link } from "react-router-dom";

export default function Breadcrumbs({ items = [] }) {
  const visibleItems = items.filter((item) => item?.label);
  if (visibleItems.length === 0) return null;

  return (
    <nav className="breadcrumbs" aria-label="פירורי לחם">
      <ol className="breadcrumbs__list">
        {visibleItems.map((item, index) => {
          const current = index === visibleItems.length - 1 || item.current;
          return (
            <li className="breadcrumbs__item" key={`${item.label}:${index}`}>
              {current ? (
                <span className="breadcrumbs__current" aria-current="page">
                  {item.label}
                </span>
              ) : item.to ? (
                <Link className="breadcrumbs__link" to={item.to}>
                  {item.label}
                </Link>
              ) : item.href ? (
                <a className="breadcrumbs__link" href={item.href}>
                  {item.label}
                </a>
              ) : (
                <span>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
