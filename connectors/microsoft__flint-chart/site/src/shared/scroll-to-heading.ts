/** Scroll a heading into view inside a nested overflow container (doc main pane). */
export function scrollToHeading(
  id: string,
  scrollContainer?: HTMLElement | null,
  offset = 16,
): boolean {
  const target = document.getElementById(id);
  if (!target) return false;

  if (scrollContainer) {
    const containerTop = scrollContainer.getBoundingClientRect().top;
    const targetTop = target.getBoundingClientRect().top;
    scrollContainer.scrollBy({
      top: targetTop - containerTop - offset,
      behavior: 'smooth',
    });
    return true;
  }

  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

export const DOC_SCROLL_TO_KEY = 'flint-doc-scroll-to';

/**
 * Scroll a sidebar just enough to bring its active item into view, and only
 * when that item is currently outside the visible area. Unlike a continuous
 * position sync, this is discrete (fires on active-item change), so it never
 * forms a scroll feedback loop or fights the user.
 */
export function scrollNavItemIntoView(
  sidebar: HTMLElement | null,
  item: HTMLElement | null,
  margin = 24,
) {
  if (!sidebar || !item) return;
  const s = sidebar.getBoundingClientRect();
  const i = item.getBoundingClientRect();
  if (i.top < s.top + margin) {
    sidebar.scrollTop -= s.top + margin - i.top;
  } else if (i.bottom > s.bottom - margin) {
    sidebar.scrollTop += i.bottom - (s.bottom - margin);
  }
}
