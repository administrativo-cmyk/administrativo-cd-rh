import type { Metadata } from "next";
import { DashboardPage, type DashboardPageProps } from "@/components/dashboards/dashboard-page";
export const metadata: Metadata = { title: "Dashboard da Chamada Diária | Administrativo CD" };
export default function Page(props: DashboardPageProps) { return <DashboardPage {...props} domain="chamada-diaria" />; }
