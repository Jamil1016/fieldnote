/** Email templates with {{merge_fields}}. Values are HTML-escaped in the body. */
import type { Candidate, ReminderKind } from "./candidates";

export interface Template {
  subject: string;
  html: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
}

export const TEMPLATES: Record<ReminderKind, Template> = {
  missing_report: {
    subject: "Daily report missing for {{report_date}}",
    html: [
      "<p>Hi {{first_name}},</p>",
      "<p>We do not have your daily report for <strong>{{report_date}}</strong>. Reports are due by 10:00 UTC on the next working day.</p>",
      "<p>Please file it today so {{lead}} can approve it. If you were not working that day, tell {{lead}} and no report is needed.</p>",
      "<p>Team: {{team}}</p>",
      "<p>Fieldnote, Example Co Field Services</p>",
    ].join("\n"),
  },
  approval_overdue: {
    subject: "{{overdue_count}} {{report_word}} waiting past the {{sla_hours}} h approval window",
    html: [
      "<p>Hi {{first_name}},</p>",
      "<p>You have <strong>{{overdue_count}}</strong> daily {{report_word}} past the {{sla_hours}} hour approval window. The oldest was filed on {{oldest_filed}}.</p>",
      "<p>Open the approvals queue, select the overdue reports and approve them in one batch.</p>",
      "<p>Fieldnote, Example Co Field Services</p>",
    ].join("\n"),
  },
};

const FIELD = /\{\{\s*([a-z_]+)\s*\}\}/g;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function mergeFieldsIn(template: string): string[] {
  return [...new Set([...template.matchAll(FIELD)].map((m) => m[1]))];
}

/** Throws if the template references a field that was not supplied. */
export function renderString(template: string, fields: Record<string, string>, escape: boolean): string {
  return template.replace(FIELD, (_match, name: string) => {
    const value = fields[name];
    if (value === undefined) throw new Error(`Template field "${name}" has no value`);
    return escape ? escapeHtml(value) : value;
  });
}

export function renderEmail(candidate: Candidate, templates: Record<ReminderKind, Template> = TEMPLATES): RenderedEmail {
  const template = templates[candidate.kind];
  return {
    // Subjects are plain text; strip line breaks so a field cannot add headers.
    subject: renderString(template.subject, candidate.fields, false).replace(/[\r\n]+/g, " "),
    html: renderString(template.html, candidate.fields, true),
  };
}
