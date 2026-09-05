/** Navigation and content must not overlap in either horizontal or vertical layouts. */
export function rectanglesOverlap(first, second) {
  for (const rectangle of [first, second]) {
    if (!rectangle || ['left', 'right', 'top', 'bottom'].some((key) => !Number.isFinite(rectangle[key]))
      || rectangle.right <= rectangle.left || rectangle.bottom <= rectangle.top) {
      throw new Error('Layout verification requires visible, finite rectangles');
    }
  }
  return first.left < second.right && second.left < first.right
    && first.top < second.bottom && second.top < first.bottom;
}
