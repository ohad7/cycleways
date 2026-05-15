import React from "react";

export default function Gallery({ photos = [] }) {
  if (photos.length === 0) return null;
  return (
    <section className="featured-gallery">
      <h2>תמונות</h2>
      <div className="featured-gallery-grid">
        {photos.map((photo, index) => {
          const src = typeof photo === "string" ? photo : photo.src;
          const caption = typeof photo === "string" ? null : photo.caption;
          return (
            <figure key={src + index} className="featured-gallery-item">
              <img src={src} alt={caption || ""} loading="lazy" />
              {caption && <figcaption>{caption}</figcaption>}
            </figure>
          );
        })}
      </div>
    </section>
  );
}
