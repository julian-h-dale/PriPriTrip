/** DOM ids linking each day tab to its panel (ARIA tabs pattern). */
export function tabId(date) {
  return `day-tab-${date}`;
}

export function panelId(date) {
  return `day-panel-${date}`;
}
