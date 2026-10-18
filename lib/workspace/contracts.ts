import { z } from "zod";
import { validDate } from "../data/daily-call-dates";
export const defaultDashboards = ["index", "monitoramento", "chamada-diaria", "banco-de-horas", "quadro-atual"] as const;
const version = z.string().datetime({ offset: true });
const page = z.object({ offset: z.number().int().min(0).max(100000).default(0), limit: z.number().int().min(1).max(100).default(25), includeArchived: z.boolean().default(false) }).strict();
const notificationFilters = page.extend({ query: z.string().trim().max(200).default(""), unreadOnly: z.boolean().default(false), type: z.enum(["all", "notice", "vacation", "daily", "import"]).default("all"), start: z.string().refine(validDate).optional(), end: z.string().refine(validDate).optional() }).refine(value => !value.start || !value.end || value.start <= value.end);
const noticeBase = z.object({ id: z.string().uuid().optional(), expectedUpdatedAt: version.optional(), reason: z.string().trim().min(5).max(1000) }).strict();
export const workspaceSchemas = {
 settings: z.object({}).strict(), notification_summary: z.object({}).strict(),
 save_preferences: z.object({ defaultDashboard: z.enum(defaultDashboards), compactTables: z.boolean(), notificationsEnabled: z.boolean(), expectedUpdatedAt: version.nullable() }).strict(),
 reset_preferences: z.object({ expectedUpdatedAt: version.nullable() }).strict(),
 save_profile: z.object({ name: z.string().trim().min(3).max(200), expectedUpdatedAt: version }).strict(),
 notifications: notificationFilters, notices: notificationFilters,
 notification_state_batch: z.object({ operation: z.enum(["read", "unread", "archive", "restore"]), items: z.array(z.object({ key: z.string().min(1).max(200), expectedUpdatedAt: version.nullable() }).strict()).min(1).max(100) }).strict().refine(value => new Set(value.items.map(item => item.key)).size === value.items.length),
 notification_state: page.extend({ key: z.string().min(1).max(200), read: z.boolean(), archived: z.boolean() }),
 save_notice: noticeBase.extend({ title: z.string().trim().min(3).max(160), body: z.string().trim().min(3).max(4000), audienceRole: z.enum(["ADMIN", "RH", "GESTOR", "LEITURA"]).nullable(), managerId: z.string().uuid().nullable() }).refine(value => Boolean(value.id) === Boolean(value.expectedUpdatedAt) && !(value.audienceRole && value.managerId)),
 archive_notice: noticeBase.required(), restore_notice: noticeBase.required(),
};
export type WorkspaceAction = keyof typeof workspaceSchemas;
export type WorkspaceSettings = { defaultDashboard: typeof defaultDashboards[number]; compactTables: boolean; notificationsEnabled: boolean; updatedAt: string | null; profileName: string; profileUpdatedAt: string };
export type NotificationItem = { key: string; type?: "notice" | "vacation" | "daily" | "import"; title: string; body: string; href: string; createdAt: string; readAt: string | null; archivedAt: string | null; updatedAt?: string | null };
export type NotificationSnapshot = { rows: NotificationItem[]; total: number; unread: number };
export type NoticeItem = { id: string; title: string; body: string; audienceRole: "ADMIN" | "RH" | "GESTOR" | "LEITURA" | null; managerId: string | null; createdAt: string; updatedAt: string; archivedAt: string | null };
export type NoticeSnapshot = { rows: NoticeItem[]; total: number; managers: { id: string; name: string }[] };
