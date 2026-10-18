import type { Metadata } from "next";
import { DashboardPage, type DashboardPageProps } from "@/components/dashboards/dashboard-page";
export const metadata: Metadata = { title: "Dashboard de Monitoramento | Administrativo CD" };
export default function Page(props: DashboardPageProps) { return <DashboardPage {...props} domain="monitoramento" />; }
