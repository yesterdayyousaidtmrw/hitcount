import type { HitcountEvent, Channel, ColorScheme, DeviceType, FingerprintReason, Props, TrafficKind } from '../types';

/** One event as a flat snake_case row, matching schema/postgres.sql column for column. */
export type EventRow = {
  /** @format uuid */
  id: string;
  name: string;
  /** @format date-time */
  time: string;
  site: string | null;
  visitor_id: string | null;
  /** @format uuid */
  session_id: string;
  user_id: string | null;
  /** @format uuid */
  page_view_id: string;
  url: string;
  path: string;
  title: string;
  referrer: string | null;
  language: string;
  timezone: string;
  screen: string;
  viewport: string;
  touch: boolean;
  user_agent: string;
  browser: string | null;
  browser_version: string | null;
  os: string | null;
  device_type: DeviceType | null;
  connection: string | null;
  color_scheme: ColorScheme | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  source_channel: Channel | null;
  source_name: string | null;
  attribution_channel: Channel | null;
  attribution_name: string | null;
  attribution_landing: string | null;
  traffic_kind: TrafficKind | null;
  traffic_signals: string[] | null;
  fingerprint_id: string | null;
  fingerprint_scrambled: boolean | null;
  fingerprint_reasons: FingerprintReason[] | null;
  props: Props;
};

/**
 * Flattens an event into one snake_case row matching schema/postgres.sql.
 * Every key is always present (null when empty) because bulk inserts need identical keys per row.
 */
export function toRow(e: HitcountEvent): EventRow {
  return {
    id: e.id,
    name: e.name,
    time: e.time,
    site: e.site ?? null,
    visitor_id: e.visitor ?? null,
    session_id: e.session,
    user_id: e.user ?? null,
    page_view_id: e.page.viewId,
    url: e.page.url,
    path: e.page.path,
    title: e.page.title,
    referrer: e.page.referrer ?? null,
    language: e.device.language,
    timezone: e.device.timezone,
    screen: e.device.screen,
    viewport: e.device.viewport,
    touch: e.device.touch,
    user_agent: e.device.userAgent,
    browser: e.device.browser ?? null,
    browser_version: e.device.browserVersion ?? null,
    os: e.device.os ?? null,
    device_type: e.device.deviceType ?? null,
    connection: e.device.connection ?? null,
    color_scheme: e.device.colorScheme ?? null,
    utm_source: e.utm?.source ?? null,
    utm_medium: e.utm?.medium ?? null,
    utm_campaign: e.utm?.campaign ?? null,
    utm_term: e.utm?.term ?? null,
    utm_content: e.utm?.content ?? null,
    source_channel: e.source?.channel ?? null,
    source_name: e.source?.name ?? null,
    attribution_channel: e.attribution?.channel ?? null,
    attribution_name: e.attribution?.name ?? null,
    attribution_landing: e.attribution?.landing ?? null,
    traffic_kind: e.traffic?.kind ?? null,
    traffic_signals: e.traffic?.signals ?? null,
    fingerprint_id: e.fingerprint?.id ?? null,
    fingerprint_scrambled: e.fingerprint?.scrambled ?? null,
    fingerprint_reasons: e.fingerprint?.reasons ?? null,
    props: e.props,
  };
}
