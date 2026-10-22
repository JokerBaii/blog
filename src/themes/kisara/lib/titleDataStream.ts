// Before ba34fe2, dissolve=0 still modulated the liquid glyph with the 9px cell field.
// Keep that detail separate from the transition's fully opaque/erased endpoints.
export const titleDataStreamFragment = `
float titleCellMask(float noise, float threshold) {
  return 1.0 - smoothstep(noise - 0.16, noise + 0.16, threshold);
}
float titleAmbientCellMask(float noise, float finalFlow) {
  return mix(1.0, titleCellMask(noise, 0.0), clamp(finalFlow, 0.0, 1.0));
}
`;
