// Scene field `perspectiveViews`: { live: { FRONT: {filename}, … }, <pictureId>: { … } }.
// Each entry is a live-view snapshot taken when the table settled at that view (never a shutter capture).
export const mapPerspectiveViews = (views, linkFor) => {
  const out = {};
  for (const [key, byView] of Object.entries(views || {})) {
    out[key] = {};
    for (const [view, file] of Object.entries(byView || {})) {
      if (file?.filename) out[key][view] = { ...file, link: linkFor(file.filename) };
    }
  }
  return out;
};
