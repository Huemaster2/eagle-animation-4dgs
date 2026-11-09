// Views of the turntable rig. A frame's ghost for a view is the snapshot taken there while posing it;
// frames with no snapshot for that view only show if they were captured from it (or before views existed).
export const resolvePerspectiveLink = (frame, perspective, perspectiveViews) => {
  if (!perspective) return frame.link;
  const snapshot = perspectiveViews?.[frame.id]?.[perspective]?.link;
  if (snapshot) return snapshot;
  return !frame.perspective || frame.perspective === perspective ? frame.link : null;
};

// Sequences tagged with a view follow the active view; untagged ones always show
export const referenceMatchesPerspective = (reference, perspective) => !perspective || !reference.perspective || reference.perspective === perspective;
