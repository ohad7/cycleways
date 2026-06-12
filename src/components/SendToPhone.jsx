import React, { useMemo } from "react";
import qrcode from "qrcode-generator";

// Renders the share URL as a QR so a desktop-planned route hops to the phone
// (today: opens mobile web; later the same URL deep-links into the app — see
// plans/navigation-handoff/design.md).
export default function SendToPhone({ shareUrl, onClose }) {
  const svgMarkup = useMemo(() => {
    if (!shareUrl) return "";
    // Type 0 auto-sizes to the data; M error correction is the QR default.
    const qr = qrcode(0, "M");
    qr.addData(shareUrl);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true });
  }, [shareUrl]);

  if (!shareUrl) return null;
  return (
    <div className="react-modal" role="dialog" aria-modal="true" aria-label="שליחת המסלול לטלפון">
      <div className="react-modal__content react-modal__content--narrow send-to-phone">
        <header className="react-modal__header">
          <h2>שלחו לטלפון</h2>
          <button className="react-modal__close" type="button" aria-label="סגירה" onClick={onClose}>
            ×
          </button>
        </header>
        <div
          className="send-to-phone__qr"
          // qrcode-generator emits a self-contained <svg> string; nothing
          // user-controlled beyond the URL is interpolated into it.
          dangerouslySetInnerHTML={{ __html: svgMarkup }}
        />
        <p className="send-to-phone__hint">סרקו עם הטלפון כדי לפתוח את המסלול בנייד</p>
      </div>
    </div>
  );
}
