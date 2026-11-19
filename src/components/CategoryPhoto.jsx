import React, { useState } from "react";
import { Package } from "lucide-react";
import media from "../data/catalog-media.json";
import images from "../data/catalog-images.json";

/** Responsive derivatives of the documented category photos; no supplier claims. */
export default function CategoryPhoto({
  kind,
  alt,
  className = "",
  sizes = "(max-width: 650px) 46vw, (max-width: 1100px) 30vw, 280px",
  priority = false,
}) {
  const [failure, setFailure] = useState({ kind: null, stage: 0 });
  const [loaded, setLoaded] = useState(null);
  const stage = failure.kind === kind ? failure.stage : 0,
    asset = media[kind],
    image = images[kind];
  if (!asset || stage >= 2)
    return (
      <div
        className={"photo-unavailable sf-no-photo " + className}
        role="img"
        aria-label="品类照片暂不可用"
      >
        <Package size={28} />
        <span>品类照片暂不可用</span>
      </div>
    );
  const variants = image?.variants || [],
    normal = variants.find((v) => v.width >= 768) || variants.at(-1);
  const optimized = stage === 0 && normal,
    src = optimized ? normal.src : asset.src;
  return (
    <img
      className={"category-photo " + className}
      src={src}
      srcSet={
        optimized
          ? variants.map((v) => `${v.src} ${v.width}w`).join(", ")
          : undefined
      }
      sizes={optimized ? sizes : undefined}
      alt={alt ?? asset.alt}
      width={image?.width || 1280}
      height={image?.height || 960}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      data-loaded={loaded === src ? "true" : "false"}
      onLoad={() => setLoaded(src)}
      onError={() => setFailure({ kind, stage: optimized ? 1 : 2 })}
    />
  );
}
