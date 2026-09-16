# KailaEdit home banner — v1

Created using the built-in image generation tool, 2026-09-06.

- banner-1664x288.svg: self-contained image asset, exact 1664 × 288 viewport matching the approximate video area in the supplied screenshot. Embeds and center-crops the generated PNG without distorting it; it is not pure vector artwork.
- source.png: original generated raster image, uncropped. Generation did not produce the requested ultra-wide dimensions, so use the SVG for the precise banner aspect ratio.

Art direction / prompt: charcoal #131315, cinematic landscape frames and curved teal editing ribbons concentrated on the right; calm dark negative space at left for the existing KailaEdit heading; no baked-in text, app UI or logos. Original generation requested 3328 × 576; actual dimensions are recorded below.

Current frontend/views/Home.tsx already uses ./banner.jpg inside an h-36 (144 CSS px) responsive container with object-cover and dark overlays. The screenshot shows a taller area. No component or existing banner was replaced. Copy the chosen asset to public and update the image src when ready; the SVG can be used directly in an img element. For a 144px banner, using the original PNG with object-cover allows more flexible cropping. Existing overlays may darken the art further.

Actual source PNG: 1699 x 926 pixels.
