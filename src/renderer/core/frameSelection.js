// Frame selection with the usual desktop rules: click selects one, Cmd/Ctrl-click toggles one,
// Shift-click selects everything between the anchor and the clicked frame (added to the selection with Cmd/Ctrl).
export const selectionClick = ({ order = [], selected = [], anchor = null }, id, { shift = false, toggle = false } = {}) => {
  const index = order.indexOf(id);
  if (index < 0) return { selected, anchor };
  if (shift && anchor !== null && order.includes(anchor)) {
    const a = order.indexOf(anchor);
    const range = order.slice(Math.min(a, index), Math.max(a, index) + 1);
    const base = toggle ? selected.filter((s) => !range.includes(s)) : [];
    return { selected: sortByOrder(order, [...base, ...range]), anchor };
  }
  if (toggle) {
    const isOn = selected.includes(id);
    return { selected: isOn ? selected.filter((s) => s !== id) : sortByOrder(order, [...selected, id]), anchor: id };
  }
  return { selected: [id], anchor: id };
};

export const sortByOrder = (order, ids) => {
  const set = new Set(ids);
  return order.filter((id) => set.has(id));
};

// Keeps the selection valid after frames are deleted or reordered
export const pruneSelection = (order, selected) => sortByOrder(order, selected);

// Arrow keys: move the single selection, or extend it with Shift
export const selectionStep = ({ order = [], selected = [], anchor = null, focus = null }, delta, { shift = false } = {}) => {
  if (!order.length) return { selected, anchor, focus };
  const from = focus !== null && order.includes(focus) ? order.indexOf(focus) : delta > 0 ? -1 : order.length;
  const next = Math.min(order.length - 1, Math.max(0, from + delta));
  const id = order[next];
  if (shift) {
    const start = anchor !== null && order.includes(anchor) ? anchor : order[Math.max(0, from)];
    return { ...selectionClick({ order, selected, anchor: start }, id, { shift: true }), focus: id };
  }
  return { selected: [id], anchor: id, focus: id };
};
