/** True when the browser sends Global Privacy Control or Do Not Track. */
export function hasPrivacySignal(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1';
}
