// Frame field `sequence`: the full rotation captured for a timeline frame; each shot keeps its preview's filename
export const mapSequenceLinks = (sequence, linkFor) =>
  sequence && Array.isArray(sequence.shots) ? { ...sequence, shots: sequence.shots.map((shot) => (shot?.filename ? { ...shot, link: linkFor(shot.filename) } : shot)) } : sequence;
