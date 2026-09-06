import React from "react";

const BASE = "https://unpkg.com/lucide-static@0.414.0/icons/";
const cache = {};

/** Lucide (1.5px stroke) inlined as SVG so it inherits currentColor. */
export function Icon({ name, size = 20, style, ...rest }) {
  const [markup, setMarkup] = React.useState(cache[name] || null);
  React.useEffect(() => {
    let live = true;
    if (cache[name]) { setMarkup(cache[name]); return; }
    fetch(BASE + name + ".svg")
      .then((r) => (r.ok ? r.text() : ""))
      .then((t) => {
        const cleaned = t
          .replace(/<\?xml[^>]*\?>/g, "")
          .replace(/width="[^"]*"/, "")
          .replace(/height="[^"]*"/, "")
          .replace(/<svg/, '<svg width="100%" height="100%"');
        cache[name] = cleaned;
        if (live) setMarkup(cleaned);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [name]);

  return (
    <span
      aria-hidden="true"
      style={{ display: "inline-flex", width: size, height: size, flex: "0 0 auto", ...style }}
      dangerouslySetInnerHTML={markup ? { __html: markup } : undefined}
      {...rest}
    />
  );
}
